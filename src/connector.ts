import axios, { AxiosInstance, AxiosRequestHeaders } from 'axios';
import {
    NatsEchoOptions,
    BroadcastEvent,
    AuthResponse,
    Subscription
} from './types';
import { Channel, PrivateChannel, EncryptedPrivateChannel } from './channel';
import { PresenceChannel } from './presence-channel';
import { NatsEventFormatter } from './event-formatter';

// NATS Protocol Constants
const NATS_PROTOCOL = {
    INFO: 'INFO',
    CONNECT: 'CONNECT',
    PUB: 'PUB',
    SUB: 'SUB',
    UNSUB: 'UNSUB',
    MSG: 'MSG',
    PING: 'PING',
    PONG: 'PONG',
    OK: '+OK',
    ERR: '-ERR'
} as const;

// Laravel Echo connector interface
interface LaravelEchoConnector {
    connect(): Promise<void>;
    disconnect(): void;
    listen(channel: string, event: string, callback: Function): any;
    channel(name: string): any;
    privateChannel(name: string): any;
    join(name: string): any;
    leave(name: string): void;
    socketId(): string;
    on(event: string, handler: Function): void;
    off(event: string, handler?: Function): void;
}

export class NatsConnector implements LaravelEchoConnector {
    private ws: WebSocket | null = null;
    private eventFormatter: NatsEventFormatter;
    private channels: Map<string, Channel> = new Map();
    private subscriptions: Map<string, Subscription> = new Map();
    private eventHandlers: Map<string, Set<Function>> = new Map();
    private reconnectTimer: any = null;
    private reconnectAttempts: number = 0;
    private socketIdentifier: string = '';
    private axios: AxiosInstance;
    private isConnecting: boolean = false;
    private connectionPromise: Promise<void> | null = null;
    private pingInterval: any = null;
    private serverInfo: any = null;
    private connected: boolean = false;
    private partialMessage: string = '';
    private pendingData: string = '';
    private bytesExpected: number = 0;

    // Laravel Echo compatibility properties
    public connector: any = this;
    public options: NatsEchoOptions;

    constructor(options: NatsEchoOptions = {}) {
        this.options = this.normalizeOptions(options);
        this.eventFormatter = new NatsEventFormatter(this.options.namespace);
        this.axios = axios.create();
        this.setupAxiosInterceptors();
        this.generateSocketId();
    }

    private normalizeOptions(options: NatsEchoOptions): NatsEchoOptions {
        const normalized: NatsEchoOptions = {
            host: options.host || window.location.hostname,
            port: options.port || 4222,
            wsPort: options.wsPort || 4223,
            wsPath: options.wsPath || '/',
            useTLS: options.useTLS || window.location.protocol === 'https:',
            forceTLS: options.forceTLS || false,
            authEndpoint: options.authEndpoint || '/broadcasting/auth',
            namespace: options.namespace || 'App\\Events',
            broadcaster: 'nats',
            maxReconnectAttempts: options.maxReconnectAttempts || 10,
            reconnectDelay: options.reconnectDelay || 3000,
            timeout: options.timeout || 10000, // 10 seconds for NATS handshake
            debug: options.debug || false,
            pingInterval: options.pingInterval || 30000, // 30 seconds
            ...options
        };

        // Ensure auth headers
        if (!normalized.auth) {
            normalized.auth = {};
        }
        if (!normalized.auth.headers) {
            normalized.auth.headers = {};
        }

        // Add CSRF token from meta tag if not provided
        if (!normalized.auth.headers['X-CSRF-TOKEN']) {
            const csrfMeta = document.querySelector('meta[name="csrf-token"]');
            if (csrfMeta) {
                normalized.auth.headers['X-CSRF-TOKEN'] = csrfMeta.getAttribute('content') || '';
            }
        }

        // Add CSRF token from options
        if (options.csrfToken && !normalized.auth.headers['X-CSRF-TOKEN']) {
            normalized.auth.headers['X-CSRF-TOKEN'] = options.csrfToken;
        }

        return normalized;
    }

    private setupAxiosInterceptors(): void {
        this.axios.interceptors.request.use((config) => {
            if (this.options.auth?.headers) {
                const headers: AxiosRequestHeaders = config.headers || {};
                Object.entries(this.options.auth.headers).forEach(([key, value]) => {
                    headers[key] = value;
                });
                config.headers = headers;
            }
            if (this.options.auth?.params && config.params) {
                config.params = {
                    ...config.params,
                    ...this.options.auth.params
                };
            }
            return config;
        });
    }

    private generateSocketId(): void {
        this.socketIdentifier = 'nats_' + Math.random().toString(36).substr(2, 9);
    }

    private buildWebSocketUrl(): string {
        const protocol = this.options.useTLS ? 'wss' : 'ws';
        const port = this.options.wsPort || 4223;
        const path = this.options.wsPath || '/';

        // Build URL WITHOUT auth parameters in query string
        // NATS text protocol expects auth in CONNECT command, not URL
        let url = `${protocol}://${this.options.host}:${port}${path}`;

        if (this.options.debug) {
            console.log('NATS WebSocket URL:', url);
        }

        return url;
    }

    public async connect(): Promise<void> {
        if (this.isConnecting && this.connectionPromise) {
            return this.connectionPromise;
        }

        if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
            return Promise.resolve();
        }

        this.isConnecting = true;
        this.connectionPromise = new Promise((resolve, reject) => {
            try {
                const url = this.buildWebSocketUrl();

                if (this.options.debug) {
                    console.log('Connecting to NATS WebSocket:', url);
                }

                this.ws = new WebSocket(url);

                // Set binary type to arraybuffer for better performance
                this.ws.binaryType = 'arraybuffer';

                this.ws.onopen = () => {
                    if (this.options.debug) {
                        console.log('NATS WebSocket: Connection opened');
                    }
                    // NATS protocol handshake starts with server sending INFO
                    // We'll handle it in onmessage
                };

                this.ws.onmessage = (event) => {
                    this.handleNatsMessage(event.data);
                };

                this.ws.onerror = (error) => {
                    if (this.options.debug) {
                        console.error('NATS WebSocket: Connection error', error);
                    }
                    this.isConnecting = false;
                    this.connected = false;
                    this.trigger('error', error);
                    reject(error);
                };

                this.ws.onclose = (event) => {
                    if (this.options.debug) {
                        console.log(`NATS WebSocket: Connection closed`, event.code, event.reason);
                    }

                    this.isConnecting = false;
                    this.connected = false;
                    this.cleanupConnection();

                    this.trigger('disconnect', event);

                    if (!event.wasClean && this.reconnectAttempts < this.options.maxReconnectAttempts!) {
                        this.scheduleReconnect();
                    }

                    reject(new Error(`Connection closed: ${event.reason || 'Unknown reason'}`));
                };

                // Connection timeout
                setTimeout(() => {
                    if (this.isConnecting) {
                        this.isConnecting = false;
                        this.ws?.close();
                        reject(new Error('NATS connection timeout (10s)'));
                    }
                }, this.options.timeout);

            } catch (error) {
                this.isConnecting = false;
                this.connected = false;
                reject(error);
            }
        });

        return this.connectionPromise;
    }

    private handleNatsMessage(data: string | ArrayBuffer): void {
        try {
            let messageStr: string;

            if (data instanceof ArrayBuffer) {
                // Convert ArrayBuffer to string
                const decoder = new TextDecoder();
                messageStr = decoder.decode(data);
            } else {
                messageStr = data;
            }

            if (this.options.debug) {
                console.log('NATS raw message:', messageStr);
            }

            // Combine with any pending partial message
            const fullMessage = this.partialMessage + messageStr;
            this.partialMessage = '';

            // Handle the message
            this.processNatsMessage(fullMessage);

        } catch (error) {
            console.error('Failed to handle NATS message:', error, data);
        }
    }

    private processNatsMessage(messageStr: string): void {
        // Check if we're waiting for data from a MSG command
        if (this.bytesExpected > 0 && this.pendingData.length < this.bytesExpected) {
            this.pendingData += messageStr;

            if (this.pendingData.length >= this.bytesExpected) {
                // We have all the data
                const data = this.pendingData.substring(0, this.bytesExpected);
                const remaining = this.pendingData.substring(this.bytesExpected);
                this.bytesExpected = 0;
                this.pendingData = '';

                this.handleCompleteMessage(data);

                // Process any remaining data
                if (remaining.trim()) {
                    this.processNatsMessage(remaining);
                }
            }
            return;
        }

        // Split by newlines but preserve empty lines for MSG protocol
        const lines = messageStr.split('\n');

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // Handle Windows line endings
            line = line.replace('\r', '');

            if (line.trim() === '') {
                continue; // Skip empty lines
            }

            if (line.startsWith(NATS_PROTOCOL.INFO + ' ')) {
                this.handleTextInfoMessage(line);
            } else if (line.startsWith(NATS_PROTOCOL.OK)) {
                this.handleOkMessage();
            } else if (line.startsWith(NATS_PROTOCOL.ERR + ' ')) {
                this.handleTextErrorMessage(line);
            } else if (line.startsWith(NATS_PROTOCOL.PING)) {
                this.handlePing();
            } else if (line.startsWith(NATS_PROTOCOL.PONG)) {
                // Ignore PONG responses
                if (this.options.debug) {
                    console.log('NATS: Received PONG');
                }
            } else if (line.startsWith(NATS_PROTOCOL.MSG + ' ')) {
                // Handle MSG protocol: MSG <subject> <sid> [reply-to] <#bytes>\r\n<data>
                this.handleMsgHeader(line, lines.slice(i + 1).join('\n'));
                break; // Rest will be handled by msg handler
            } else {
                if (this.options.debug) {
                    console.log('Unhandled NATS line:', line);
                }
            }
        }
    }

    private handleMsgHeader(headerLine: string, remainingData: string): void {
        // Parse: MSG <subject> <sid> [reply-to] <#bytes>
        const parts = headerLine.split(' ');
        if (parts.length < 4) {
            console.error('Invalid MSG header:', headerLine);
            return;
        }

        const subject = parts[1];
        const sid = parts[2];

        // Find the byte count (last part before optional reply-to)
        let byteCountStr = parts[parts.length - 1];
        this.bytesExpected = parseInt(byteCountStr, 10);

        if (isNaN(this.bytesExpected)) {
            console.error('Invalid byte count in MSG:', byteCountStr);
            this.bytesExpected = 0;
            return;
        }

        if (this.options.debug) {
            console.log(`NATS MSG: subject=${subject}, sid=${sid}, bytes=${this.bytesExpected}`);
        }

        // Start collecting data
        this.pendingData = remainingData;

        // If we already have all the data, process it immediately
        if (this.pendingData.length >= this.bytesExpected) {
            const data = this.pendingData.substring(0, this.bytesExpected);
            const extra = this.pendingData.substring(this.bytesExpected);
            this.bytesExpected = 0;
            this.pendingData = '';

            this.handleCompleteMessage(data);

            // Process any extra data
            if (extra.trim()) {
                this.processNatsMessage(extra);
            }
        }
    }

    private handleCompleteMessage(data: string): void {
        try {
            // Parse the message data
            let parsedData;
            try {
                parsedData = JSON.parse(data);
            } catch {
                parsedData = data;
            }

            // Convert to Laravel broadcast format
            const laravelEvent: BroadcastEvent = {
                event: parsedData.event || 'NatsMessage',
                data: parsedData.data || parsedData,
                channel: 'unknown', // We'll set this from subscription mapping
                socket: this.socketIdentifier,
                timestamp: new Date().toISOString()
            };

            // Try to find the channel by SID (we need to track this better)
            // For now, we'll rely on the subject from the subscription
            this.handleBroadcastEvent(laravelEvent);

        } catch (error) {
            console.error('Error handling complete message:', error, data);
        }
    }

    private handleTextInfoMessage(infoLine: string): void {
        try {
            // Extract JSON from "INFO {json}"
            const jsonStr = infoLine.substring(NATS_PROTOCOL.INFO.length + 1);
            const info = JSON.parse(jsonStr);

            if (this.options.debug) {
                console.log('NATS Server Info:', info);
            }

            this.serverInfo = info;

            // Send CONNECT response with authentication
            const connectMsg: any = {
                lang: 'javascript',
                version: '2.0.0',
                protocol: 0, // 0 = text protocol
                verbose: this.options.debug || false,
                pedantic: false,
                headers: info.headers || false,
                echo: true,
                tls_required: false,
                name: `laravel-echo-nats-${this.socketIdentifier}`
            };

            // Add authentication if required
            if (info.auth_required) {
                if (this.options.user) {
                    connectMsg.user = this.options.user;
                }
                if (this.options.pass) {
                    connectMsg.pass = this.options.pass;
                }
                if (this.options.token) {
                    connectMsg.auth_token = this.options.token;
                }
            }

            // Remove undefined values
            Object.keys(connectMsg).forEach(key => {
                if (connectMsg[key] === undefined) {
                    delete connectMsg[key];
                }
            });

            // Send CONNECT command
            const connectCommand = `${NATS_PROTOCOL.CONNECT} ${JSON.stringify(connectMsg)}\r\n`;
            this.sendRawToNats(connectCommand);

            if (this.options.debug) {
                console.log('Sent CONNECT:', connectCommand);
            }

        } catch (error) {
            console.error('Failed to handle INFO message:', error, infoLine);
        }
    }

    private handleTextErrorMessage(errLine: string): void {
        // Extract error message from "-ERR 'message'"
        let errorMessage = 'Unknown error';

        if (errLine.startsWith("-ERR '") && errLine.endsWith("'")) {
            errorMessage = errLine.substring(6, errLine.length - 1);
        } else if (errLine.startsWith('-ERR ')) {
            errorMessage = errLine.substring(5);
        }

        const error = new Error(`NATS server error: ${errorMessage}`);

        console.error('NATS error:', errorMessage);

        this.trigger('error', error);

        if (this.isConnecting) {
            this.isConnecting = false;
            this.connected = false;
            this.ws?.close();

            // Reject the connection promise
            if (this.connectionPromise) {
                const promise = this.connectionPromise as any;
                promise._reject?.(error);
            }
        }
    }

    private handlePing(): void {
        if (this.options.debug) {
            console.log('NATS: Received PING');
        }

        // Respond with PONG
        this.sendRawToNats(`${NATS_PROTOCOL.PONG}\r\n`);
    }

    private handleOkMessage(): void {
        if (this.options.debug) {
            console.log('NATS: Server accepted connection');
        }

        this.isConnecting = false;
        this.connected = true;
        this.reconnectAttempts = 0;

        // Start ping interval
        this.startPingInterval();

        // Resubscribe to all channels
        this.resubscribeAll();

        // Trigger events
        this.trigger('connect');
        this.trigger('connected');

        // Resolve connection promise
        if (this.connectionPromise) {
            const promise = this.connectionPromise as any;
            promise._resolve?.();
        }
    }

    private startPingInterval(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }

        const interval = this.options.pingInterval || 30000;
        this.pingInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN && this.connected) {
                if (this.options.debug) {
                    console.log('NATS: Sending PING');
                }
                this.sendRawToNats(`${NATS_PROTOCOL.PING}\r\n`);
            }
        }, interval);
    }

    private cleanupConnection(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }

        this.serverInfo = null;
        this.partialMessage = '';
        this.pendingData = '';
        this.bytesExpected = 0;
    }

    private sendRawToNats(command: string): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            if (this.options.debug) {
                console.log('NATS: Sending:', command);
            }
            this.ws.send(command);
        } else {
            console.error('NATS Echo: Cannot send, connection not open');
        }
    }

    private sendToNats(data: any): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            let command = '';

            if (data.op === 'pub') {
                // PUB <subject> <#bytes>\r\n<data>
                const subject = data.subject;
                const payload = typeof data.data === 'string' ? data.data : JSON.stringify(data.data);
                const size = new TextEncoder().encode(payload).length;
                command = `${NATS_PROTOCOL.PUB} ${subject} ${size}\r\n${payload}\r\n`;
            } else if (data.op === 'sub') {
                // SUB <subject> <sid>
                const subject = data.subject;
                const sid = data.sid;
                const queue = data.queue || '';
                if (queue) {
                    command = `${NATS_PROTOCOL.SUB} ${subject} ${queue} ${sid}\r\n`;
                } else {
                    command = `${NATS_PROTOCOL.SUB} ${subject} ${sid}\r\n`;
                }
            } else if (data.op === 'unsub') {
                // UNSUB <sid> [max-msgs]
                const sid = data.sid;
                const max = data.max || '';
                command = `${NATS_PROTOCOL.UNSUB} ${sid} ${max}\r\n`.trim() + '\r\n';
            } else if (data.op === 'ping') {
                command = `${NATS_PROTOCOL.PING}\r\n`;
            } else if (data.op === 'pong') {
                command = `${NATS_PROTOCOL.PONG}\r\n`;
            }

            if (command && this.options.debug) {
                console.log('NATS: Sending command:', command);
            }

            if (command) {
                this.ws.send(command);
            }
        } else {
            console.error('NATS Echo: Cannot send, connection not open');
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.reconnectAttempts++;
        const delay = Math.min(
            this.options.reconnectDelay! * Math.pow(1.5, this.reconnectAttempts - 1),
            30000
        );

        if (this.options.debug) {
            console.log(`NATS Echo: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts})`);
        }

        this.trigger('reconnecting', this.reconnectAttempts);

        this.reconnectTimer = setTimeout(() => {
            if (this.ws?.readyState === WebSocket.CLOSED) {
                this.connect().catch(console.error);
            }
        }, delay);
    }

    private async handleBroadcastEvent(event: BroadcastEvent): Promise<void> {
        const channelName = typeof event.channel === 'string'
            ? event.channel
            : event.channel.name;

        // Process event with namespace
        const formattedEvent = this.eventFormatter.format(this.options.namespace!, event.event);

        // Trigger global event listeners
        this.trigger('message', event);
        this.trigger(`event:${formattedEvent}`, event.data);

        // Trigger channel-specific listeners
        const channel = this.channels.get(channelName);
        if (channel) {
            channel.trigger(formattedEvent, event.data);

            // Also trigger with original event name for compatibility
            channel.trigger(event.event, event.data);
        }
    }

    private async resubscribeAll(): Promise<void> {
        for (const [channelName, channel] of this.channels.entries()) {
            if (channel.isSubscribed()) {
                try {
                    await this.sendSubscribe(channelName, channel);
                } catch (error) {
                    console.error(`Failed to resubscribe to ${channelName}:`, error);
                }
            }
        }
    }

    private async sendSubscribe(channelName: string, channel: Channel): Promise<void> {
        const subscription = this.subscriptions.get(channelName);
        if (!subscription) {
            console.error(`No subscription found for channel ${channelName}`);
            return;
        }

        // Send NATS SUBSCRIBE command
        const subMsg = {
            op: 'sub',
            subject: channelName,
            sid: subscription.sid
        };

        this.sendToNats(subMsg);
    }

    public async authenticatePrivateChannel(channelName: string): Promise<AuthResponse> {
        try {
            const response = await this.axios.post(this.options.authEndpoint!, {
                channel_name: channelName,
                socket_id: this.socketIdentifier
            });

            return response.data;
        } catch (error) {
            console.error('NATS Echo: Authentication failed for', channelName, error);
            throw error;
        }
    }

    // ========== Connector Interface Implementation ==========

    public listen(channelName: string, event: string, callback: Function): Channel {
        const channel = this.channel(channelName);
        channel.listen(event, callback);
        return channel;
    }

    public channel(channelName: string): Channel {
        if (!this.channels.has(channelName)) {
            const channel = new Channel(this, channelName);
            this.channels.set(channelName, channel);

            // Create subscription entry
            const sid = 'sid_' + Math.random().toString(36).substr(2, 9);
            this.subscriptions.set(channelName, {
                sid,
                channel,
                listeners: {}
            });
        }
        return this.channels.get(channelName)!;
    }

    public privateChannel(channelName: string): PrivateChannel {
        const fullName = `private-${channelName}`;

        if (!this.channels.has(fullName)) {
            const channel = new PrivateChannel(this, channelName);
            this.channels.set(fullName, channel);

            // Create subscription entry
            const sid = 'priv_' + Math.random().toString(36).substr(2, 9);
            this.subscriptions.set(fullName, {
                sid,
                channel,
                listeners: {}
            });
        }
        return this.channels.get(fullName) as PrivateChannel;
    }

    public encryptedPrivateChannel(channelName: string): EncryptedPrivateChannel {
        const fullName = `private-encrypted-${channelName}`;

        if (!this.channels.has(fullName)) {
            const channel = new EncryptedPrivateChannel(this, channelName);
            this.channels.set(fullName, channel);

            // Create subscription entry
            const sid = 'enc_' + Math.random().toString(36).substr(2, 9);
            this.subscriptions.set(fullName, {
                sid,
                channel,
                listeners: {}
            });
        }
        return this.channels.get(fullName) as EncryptedPrivateChannel;
    }

    public join(channelName: string): PresenceChannel {
        const fullName = `presence-${channelName}`;

        if (!this.channels.has(fullName)) {
            const channel = new PresenceChannel(this, channelName);
            this.channels.set(fullName, channel);

            // Create subscription entry
            const sid = 'pres_' + Math.random().toString(36).substr(2, 9);
            this.subscriptions.set(fullName, {
                sid,
                channel,
                listeners: {}
            });
        }
        return this.channels.get(fullName) as PresenceChannel;
    }

    public leave(channelName: string): void {
        const channel = this.channels.get(channelName);
        if (channel) {
            channel.unsubscribe();
            this.channels.delete(channelName);

            // Send unsubscribe to NATS
            const subscription = this.subscriptions.get(channelName);
            if (subscription) {
                const unsubMsg = {
                    op: 'unsub',
                    sid: subscription.sid
                };
                this.sendToNats(unsubMsg);
                this.subscriptions.delete(channelName);
            }
        }
    }

    public notification(userId: string | number): Channel {
        const channelName = `private-App.Models.User.${userId}`;
        return this.privateChannel(channelName);
    }

    public socketId(): string {
        return this.socketIdentifier;
    }

    public isConnected(): boolean {
        return this.connected && this.ws?.readyState === WebSocket.OPEN;
    }

    public disconnect(): void {
        // Clear all channels
        this.channels.forEach(channel => {
            channel.unsubscribe();
        });
        this.channels.clear();
        this.subscriptions.clear();

        // Cleanup connection
        this.cleanupConnection();

        // Close WebSocket
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        // Clear reconnect timer
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.connected = false;
        this.trigger('disconnected');
    }

    public on(event: string, handler: Function): void {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Set());
        }
        this.eventHandlers.get(event)!.add(handler);
    }

    public off(event: string, handler?: Function): void {
        if (!this.eventHandlers.has(event)) {
            return;
        }

        if (handler) {
            this.eventHandlers.get(event)!.delete(handler);
        } else {
            this.eventHandlers.delete(event);
        }
    }

    private trigger(event: string, ...args: any[]): void {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event)!.forEach(handler => {
                try {
                    handler(...args);
                } catch (error) {
                    console.error(`Error in event handler for "${event}":`, error);
                }
            });
        }
    }

    // Internal method for channels to subscribe
    public async subscribeChannel(channel: Channel): Promise<void> {
        const channelName = channel.getName();
        const subscription = this.subscriptions.get(channelName);

        if (!subscription) {
            throw new Error(`No subscription found for channel ${channelName}`);
        }

        // Only subscribe if we're connected
        if (this.isConnected()) {
            await this.sendSubscribe(channelName, channel);
        }
    }

    // Internal method for channels to unsubscribe
    public unsubscribeChannel(channel: Channel): void {
        const channelName = channel.getName();
        const subscription = this.subscriptions.get(channelName);

        if (subscription && this.isConnected()) {
            const unsubMsg = {
                op: 'unsub',
                sid: subscription.sid
            };
            this.sendToNats(unsubMsg);
        }
    }

    // Helper to send messages (for whispers, etc.)
    public send(subject: string, data: any): void {
        if (!this.isConnected()) {
            console.error('Cannot send, not connected to NATS');
            return;
        }

        const pubMsg = {
            op: 'pub',
            subject,
            data: typeof data === 'string' ? data : JSON.stringify(data)
        };

        this.sendToNats(pubMsg);
    }

    public getConfig(): NatsEchoOptions {
        return { ...this.options };
    }

    // Static method to create broadcaster for Laravel Echo
    static asBroadcaster(): any {
        return {
            install(echo: any, options: NatsEchoOptions = {}) {
                const connector = new NatsConnector(options);

                // Store connector reference
                echo.connector = connector;
                echo.nats = connector;

                // Override Echo methods to use NATS connector
                echo.channel = (name: string) => {
                    return connector.channel(name);
                };

                echo.private = (name: string) => {
                    return connector.privateChannel(name);
                };

                echo.encryptedPrivate = (name: string) => {
                    return connector.encryptedPrivateChannel(name);
                };

                echo.join = (name: string) => {
                    return connector.join(name);
                };

                echo.leave = (name: string) => {
                    connector.leave(name);
                };

                echo.leaveChannel = echo.leave;

                echo.notification = (userId: string | number) => {
                    return connector.notification(userId);
                };

                echo.disconnect = () => {
                    connector.disconnect();
                };

                echo.socketId = (): string => {
                    return connector.socketId();
                };

                echo.on = (event: string, handler: Function) => {
                    connector.on(event, handler);
                    return echo; // Allow chaining
                };

                echo.off = (event: string, handler?: Function) => {
                    connector.off(event, handler);
                    return echo; // Allow chaining
                };

                echo.listen = (channel: string, event: string, callback: Function) => {
                    return connector.listen(channel, event, callback);
                };

                // Connect automatically
                connector.connect().catch((error: Error) => {
                    console.error('NATS Echo: Failed to connect', error);
                    echo.trigger?.('error', error);
                });

                return echo;
            }
        };
    }
}