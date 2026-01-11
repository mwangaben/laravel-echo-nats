'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var axios = require('axios');

class BaseChannel {
    constructor(connector, name, options = {}) {
        this.connector = connector;
        this.name = name;
        this.options = options;
        this.listeners = {};
        this.subscribed = false;
        this.subscriptionId = '';
        this.generateSubscriptionId();
    }
    generateSubscriptionId() {
        this.subscriptionId = 'sub_' + Math.random().toString(36).substr(2, 9);
    }
    async subscribe() {
        if (this.subscribed) {
            return this;
        }
        try {
            // Use the connector's subscribe method
            await this.connector.subscribeChannel(this);
            this.subscribed = true;
        }
        catch (error) {
            console.error(`Failed to subscribe to channel ${this.name}:`, error);
            throw error;
        }
        return this;
    }
    unsubscribe() {
        if (!this.subscribed) {
            return this;
        }
        try {
            // Use the connector's unsubscribe method
            this.connector.unsubscribeChannel(this);
            this.subscribed = false;
            this.listeners = {};
        }
        catch (error) {
            console.error(`Failed to unsubscribe from channel ${this.name}:`, error);
        }
        return this;
    }
    listen(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
        // Auto-subscribe on first listener
        if (!this.subscribed && Object.keys(this.listeners).length === 1) {
            this.subscribe().catch(console.error);
        }
        return this;
    }
    notification(callback) {
        return this.listen('Illuminate\\Notifications\\Events\\BroadcastNotificationCreated', callback);
    }
    listenForWhisper(event, callback) {
        return this.listen('.client-' + event, callback);
    }
    stopListening(event, callback) {
        if (!event) {
            // Remove all listeners
            this.listeners = {};
            this.unsubscribe();
            return this;
        }
        if (!this.listeners[event]) {
            return this;
        }
        if (callback) {
            const index = this.listeners[event].indexOf(callback);
            if (index > -1) {
                this.listeners[event].splice(index, 1);
            }
        }
        else {
            delete this.listeners[event];
        }
        // Unsubscribe if no listeners left
        if (Object.keys(this.listeners).length === 0) {
            this.unsubscribe();
        }
        return this;
    }
    getName() {
        return this.name;
    }
    isSubscribed() {
        return this.subscribed;
    }
    getListeners(event) {
        if (event) {
            return this.listeners[event] || [];
        }
        // Flatten all listeners
        return Object.values(this.listeners).reduce((acc, val) => acc.concat(val), []);
    }
    trigger(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => {
                try {
                    callback(data);
                }
                catch (error) {
                    console.error(`Error in channel ${this.name} event handler for "${event}":`, error);
                }
            });
        }
        // Also trigger wildcard listeners
        if (this.listeners['*']) {
            this.listeners['*'].forEach(callback => {
                try {
                    callback(event, data);
                }
                catch (error) {
                    console.error(`Error in channel ${this.name} wildcard handler for "${event}":`, error);
                }
            });
        }
    }
}
class Channel extends BaseChannel {
}
class PrivateChannel extends BaseChannel {
    constructor(connector, name, options = {}) {
        super(connector, 'private-' + name, options);
    }
    async subscribe() {
        // For private channels, authenticate first
        try {
            await this.connector.authenticatePrivateChannel(this.name);
            return await super.subscribe();
        }
        catch (error) {
            console.error(`Authentication failed for private channel ${this.name}:`, error);
            throw error;
        }
    }
    whisper(eventName, data) {
        // Send whisper through connector
        const whisperSubject = `${this.name}.whisper.${eventName}`;
        this.connector.send(whisperSubject, data);
        return this;
    }
}
class EncryptedPrivateChannel extends PrivateChannel {
    constructor(connector, name, options = {}) {
        super(connector, 'private-encrypted-' + name, options);
    }
}

class PresenceChannel extends PrivateChannel {
    constructor(connector, name, options = {}) {
        super(connector, 'presence-' + name, options);
        this.members = new Map();
        this.hereCallbacks = [];
        this.joiningCallbacks = [];
        this.leavingCallbacks = [];
    }
    async subscribe() {
        if (this.subscribed) {
            return this;
        }
        await super.subscribe();
        // Set up presence event listeners
        this.listen('presence:here', (users) => {
            this.updateMembers(users);
            this.triggerHere(users);
        });
        this.listen('presence:joining', (user) => {
            this.addMember(user);
            this.triggerJoining(user);
        });
        this.listen('presence:leaving', (user) => {
            this.removeMember(user);
            this.triggerLeaving(user);
        });
        return this;
    }
    unsubscribe() {
        this.subscribed = false;
        return this;
    }
    here(callback) {
        this.hereCallbacks.push(callback);
        // Trigger immediately if we already have members
        if (this.members.size > 0) {
            callback(this.getMembers());
        }
        return this;
    }
    joining(callback) {
        this.joiningCallbacks.push(callback);
        return this;
    }
    leaving(callback) {
        this.leavingCallbacks.push(callback);
        return this;
    }
    whisper(eventName, data) {
        // Override parent whisper to include presence channel specific logic
        return super.whisper(eventName, data);
    }
    getMembers() {
        return Array.from(this.members.values());
    }
    getMember(userId) {
        return this.members.get(userId);
    }
    updateMembers(users) {
        this.members.clear();
        users.forEach(user => {
            if (user.id || user.user_id) {
                const userId = user.id || user.user_id;
                this.members.set(userId, user);
            }
        });
    }
    addMember(user) {
        const userId = user.id || user.user_id;
        if (userId) {
            this.members.set(userId, user);
        }
    }
    removeMember(user) {
        const userId = user.id || user.user_id;
        if (userId) {
            this.members.delete(userId);
        }
    }
    triggerHere(users) {
        this.hereCallbacks.forEach(callback => {
            try {
                callback(users);
            }
            catch (error) {
                console.error('Error in here callback:', error);
            }
        });
    }
    triggerJoining(user) {
        this.joiningCallbacks.forEach(callback => {
            try {
                callback(user);
            }
            catch (error) {
                console.error('Error in joining callback:', error);
            }
        });
    }
    triggerLeaving(user) {
        this.leavingCallbacks.forEach(callback => {
            try {
                callback(user);
            }
            catch (error) {
                console.error('Error in leaving callback:', error);
            }
        });
    }
    // Handle presence-specific events from the connector
    handlePresenceEvent(event, data) {
        switch (event) {
            case 'presence:here':
                this.updateMembers(data);
                this.triggerHere(data);
                break;
            case 'presence:joining':
                this.addMember(data);
                this.triggerJoining(data);
                break;
            case 'presence:leaving':
                this.removeMember(data);
                this.triggerLeaving(data);
                break;
        }
    }
}

class NatsEventFormatter {
    constructor(namespace) {
        this.namespace = 'App\\Events';
        if (namespace) {
            this.namespace = namespace;
        }
    }
    format(namespace, event) {
        // If event is already namespaced, return as is
        if (event.startsWith(namespace)) {
            return event;
        }
        // Format: Namespace\EventName
        return namespace + '\\' + event;
    }
    setNamespace(namespace) {
        this.namespace = namespace;
    }
    getNamespace() {
        return this.namespace;
    }
    // Helper to check if event belongs to namespace
    belongsToNamespace(eventName) {
        return eventName.startsWith(this.namespace);
    }
    // Extract event name without namespace
    getEventNameWithoutNamespace(eventName) {
        if (this.belongsToNamespace(eventName)) {
            // Remove namespace and leading backslash
            return eventName.substring(this.namespace.length + 1);
        }
        return eventName;
    }
}

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
};
class NatsConnector {
    constructor(options = {}) {
        this.ws = null;
        this.channels = new Map();
        this.subscriptions = new Map();
        this.eventHandlers = new Map();
        this.reconnectTimer = null;
        this.reconnectAttempts = 0;
        this.socketIdentifier = '';
        this.isConnecting = false;
        this.connectionPromise = null;
        this.pingInterval = null;
        this.serverInfo = null;
        this.connected = false;
        this.partialMessage = '';
        this.pendingData = '';
        this.bytesExpected = 0;
        // Laravel Echo compatibility properties
        this.connector = this;
        this.options = this.normalizeOptions(options);
        this.eventFormatter = new NatsEventFormatter(this.options.namespace);
        this.axios = axios.create();
        this.setupAxiosInterceptors();
        this.generateSocketId();
    }
    normalizeOptions(options) {
        const normalized = {
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
    setupAxiosInterceptors() {
        this.axios.interceptors.request.use((config) => {
            var _a, _b;
            if ((_a = this.options.auth) === null || _a === void 0 ? void 0 : _a.headers) {
                const headers = config.headers || {};
                Object.entries(this.options.auth.headers).forEach(([key, value]) => {
                    headers[key] = value;
                });
                config.headers = headers;
            }
            if (((_b = this.options.auth) === null || _b === void 0 ? void 0 : _b.params) && config.params) {
                config.params = {
                    ...config.params,
                    ...this.options.auth.params
                };
            }
            return config;
        });
    }
    generateSocketId() {
        this.socketIdentifier = 'nats_' + Math.random().toString(36).substr(2, 9);
    }
    buildWebSocketUrl() {
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
    async connect() {
        var _a;
        if (this.isConnecting && this.connectionPromise) {
            return this.connectionPromise;
        }
        if (this.connected && ((_a = this.ws) === null || _a === void 0 ? void 0 : _a.readyState) === WebSocket.OPEN) {
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
                    if (!event.wasClean && this.reconnectAttempts < this.options.maxReconnectAttempts) {
                        this.scheduleReconnect();
                    }
                    reject(new Error(`Connection closed: ${event.reason || 'Unknown reason'}`));
                };
                // Connection timeout
                setTimeout(() => {
                    var _a;
                    if (this.isConnecting) {
                        this.isConnecting = false;
                        (_a = this.ws) === null || _a === void 0 ? void 0 : _a.close();
                        reject(new Error('NATS connection timeout (10s)'));
                    }
                }, this.options.timeout);
            }
            catch (error) {
                this.isConnecting = false;
                this.connected = false;
                reject(error);
            }
        });
        return this.connectionPromise;
    }
    handleNatsMessage(data) {
        try {
            let messageStr;
            if (data instanceof ArrayBuffer) {
                // Convert ArrayBuffer to string
                const decoder = new TextDecoder();
                messageStr = decoder.decode(data);
            }
            else {
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
        }
        catch (error) {
            console.error('Failed to handle NATS message:', error, data);
        }
    }
    processNatsMessage(messageStr) {
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
            }
            else if (line.startsWith(NATS_PROTOCOL.OK)) {
                this.handleOkMessage();
            }
            else if (line.startsWith(NATS_PROTOCOL.ERR + ' ')) {
                this.handleTextErrorMessage(line);
            }
            else if (line.startsWith(NATS_PROTOCOL.PING)) {
                this.handlePing();
            }
            else if (line.startsWith(NATS_PROTOCOL.PONG)) {
                // Ignore PONG responses
                if (this.options.debug) {
                    console.log('NATS: Received PONG');
                }
            }
            else if (line.startsWith(NATS_PROTOCOL.MSG + ' ')) {
                // Handle MSG protocol: MSG <subject> <sid> [reply-to] <#bytes>\r\n<data>
                this.handleMsgHeader(line, lines.slice(i + 1).join('\n'));
                break; // Rest will be handled by msg handler
            }
            else {
                if (this.options.debug) {
                    console.log('Unhandled NATS line:', line);
                }
            }
        }
    }
    handleMsgHeader(headerLine, remainingData) {
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
    handleCompleteMessage(data) {
        try {
            // Parse the message data
            let parsedData;
            try {
                parsedData = JSON.parse(data);
            }
            catch {
                parsedData = data;
            }
            // Convert to Laravel broadcast format
            const laravelEvent = {
                event: parsedData.event || 'NatsMessage',
                data: parsedData.data || parsedData,
                channel: 'unknown', // We'll set this from subscription mapping
                socket: this.socketIdentifier,
                timestamp: new Date().toISOString()
            };
            // Try to find the channel by SID (we need to track this better)
            // For now, we'll rely on the subject from the subscription
            this.handleBroadcastEvent(laravelEvent);
        }
        catch (error) {
            console.error('Error handling complete message:', error, data);
        }
    }
    handleTextInfoMessage(infoLine) {
        try {
            // Extract JSON from "INFO {json}"
            const jsonStr = infoLine.substring(NATS_PROTOCOL.INFO.length + 1);
            const info = JSON.parse(jsonStr);
            if (this.options.debug) {
                console.log('NATS Server Info:', info);
            }
            this.serverInfo = info;
            // Send CONNECT response with authentication
            const connectMsg = {
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
        }
        catch (error) {
            console.error('Failed to handle INFO message:', error, infoLine);
        }
    }
    handleTextErrorMessage(errLine) {
        var _a, _b;
        // Extract error message from "-ERR 'message'"
        let errorMessage = 'Unknown error';
        if (errLine.startsWith("-ERR '") && errLine.endsWith("'")) {
            errorMessage = errLine.substring(6, errLine.length - 1);
        }
        else if (errLine.startsWith('-ERR ')) {
            errorMessage = errLine.substring(5);
        }
        const error = new Error(`NATS server error: ${errorMessage}`);
        console.error('NATS error:', errorMessage);
        this.trigger('error', error);
        if (this.isConnecting) {
            this.isConnecting = false;
            this.connected = false;
            (_a = this.ws) === null || _a === void 0 ? void 0 : _a.close();
            // Reject the connection promise
            if (this.connectionPromise) {
                const promise = this.connectionPromise;
                (_b = promise._reject) === null || _b === void 0 ? void 0 : _b.call(promise, error);
            }
        }
    }
    handlePing() {
        if (this.options.debug) {
            console.log('NATS: Received PING');
        }
        // Respond with PONG
        this.sendRawToNats(`${NATS_PROTOCOL.PONG}\r\n`);
    }
    handleOkMessage() {
        var _a;
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
            const promise = this.connectionPromise;
            (_a = promise._resolve) === null || _a === void 0 ? void 0 : _a.call(promise);
        }
    }
    startPingInterval() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }
        const interval = this.options.pingInterval || 30000;
        this.pingInterval = setInterval(() => {
            var _a;
            if (((_a = this.ws) === null || _a === void 0 ? void 0 : _a.readyState) === WebSocket.OPEN && this.connected) {
                if (this.options.debug) {
                    console.log('NATS: Sending PING');
                }
                this.sendRawToNats(`${NATS_PROTOCOL.PING}\r\n`);
            }
        }, interval);
    }
    cleanupConnection() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        this.serverInfo = null;
        this.partialMessage = '';
        this.pendingData = '';
        this.bytesExpected = 0;
    }
    sendRawToNats(command) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            if (this.options.debug) {
                console.log('NATS: Sending:', command);
            }
            this.ws.send(command);
        }
        else {
            console.error('NATS Echo: Cannot send, connection not open');
        }
    }
    sendToNats(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            let command = '';
            if (data.op === 'pub') {
                // PUB <subject> <#bytes>\r\n<data>
                const subject = data.subject;
                const payload = typeof data.data === 'string' ? data.data : JSON.stringify(data.data);
                const size = new TextEncoder().encode(payload).length;
                command = `${NATS_PROTOCOL.PUB} ${subject} ${size}\r\n${payload}\r\n`;
            }
            else if (data.op === 'sub') {
                // SUB <subject> <sid>
                const subject = data.subject;
                const sid = data.sid;
                const queue = data.queue || '';
                if (queue) {
                    command = `${NATS_PROTOCOL.SUB} ${subject} ${queue} ${sid}\r\n`;
                }
                else {
                    command = `${NATS_PROTOCOL.SUB} ${subject} ${sid}\r\n`;
                }
            }
            else if (data.op === 'unsub') {
                // UNSUB <sid> [max-msgs]
                const sid = data.sid;
                const max = data.max || '';
                command = `${NATS_PROTOCOL.UNSUB} ${sid} ${max}\r\n`.trim() + '\r\n';
            }
            else if (data.op === 'ping') {
                command = `${NATS_PROTOCOL.PING}\r\n`;
            }
            else if (data.op === 'pong') {
                command = `${NATS_PROTOCOL.PONG}\r\n`;
            }
            if (command && this.options.debug) {
                console.log('NATS: Sending command:', command);
            }
            if (command) {
                this.ws.send(command);
            }
        }
        else {
            console.error('NATS Echo: Cannot send, connection not open');
        }
    }
    scheduleReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        this.reconnectAttempts++;
        const delay = Math.min(this.options.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 30000);
        if (this.options.debug) {
            console.log(`NATS Echo: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts})`);
        }
        this.trigger('reconnecting', this.reconnectAttempts);
        this.reconnectTimer = setTimeout(() => {
            var _a;
            if (((_a = this.ws) === null || _a === void 0 ? void 0 : _a.readyState) === WebSocket.CLOSED) {
                this.connect().catch(console.error);
            }
        }, delay);
    }
    async handleBroadcastEvent(event) {
        const channelName = typeof event.channel === 'string'
            ? event.channel
            : event.channel.name;
        // Process event with namespace
        const formattedEvent = this.eventFormatter.format(this.options.namespace, event.event);
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
    async resubscribeAll() {
        for (const [channelName, channel] of this.channels.entries()) {
            if (channel.isSubscribed()) {
                try {
                    await this.sendSubscribe(channelName, channel);
                }
                catch (error) {
                    console.error(`Failed to resubscribe to ${channelName}:`, error);
                }
            }
        }
    }
    async sendSubscribe(channelName, channel) {
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
    async authenticatePrivateChannel(channelName) {
        try {
            const response = await this.axios.post(this.options.authEndpoint, {
                channel_name: channelName,
                socket_id: this.socketIdentifier
            });
            return response.data;
        }
        catch (error) {
            console.error('NATS Echo: Authentication failed for', channelName, error);
            throw error;
        }
    }
    // ========== Connector Interface Implementation ==========
    listen(channelName, event, callback) {
        const channel = this.channel(channelName);
        channel.listen(event, callback);
        return channel;
    }
    channel(channelName) {
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
        return this.channels.get(channelName);
    }
    privateChannel(channelName) {
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
        return this.channels.get(fullName);
    }
    encryptedPrivateChannel(channelName) {
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
        return this.channels.get(fullName);
    }
    join(channelName) {
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
        return this.channels.get(fullName);
    }
    leave(channelName) {
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
    notification(userId) {
        const channelName = `private-App.Models.User.${userId}`;
        return this.privateChannel(channelName);
    }
    socketId() {
        return this.socketIdentifier;
    }
    isConnected() {
        var _a;
        return this.connected && ((_a = this.ws) === null || _a === void 0 ? void 0 : _a.readyState) === WebSocket.OPEN;
    }
    disconnect() {
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
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Set());
        }
        this.eventHandlers.get(event).add(handler);
    }
    off(event, handler) {
        if (!this.eventHandlers.has(event)) {
            return;
        }
        if (handler) {
            this.eventHandlers.get(event).delete(handler);
        }
        else {
            this.eventHandlers.delete(event);
        }
    }
    trigger(event, ...args) {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).forEach(handler => {
                try {
                    handler(...args);
                }
                catch (error) {
                    console.error(`Error in event handler for "${event}":`, error);
                }
            });
        }
    }
    // Internal method for channels to subscribe
    async subscribeChannel(channel) {
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
    unsubscribeChannel(channel) {
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
    send(subject, data) {
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
    getConfig() {
        return { ...this.options };
    }
    // Static method to create broadcaster for Laravel Echo
    static asBroadcaster() {
        return {
            install(echo, options = {}) {
                const connector = new NatsConnector(options);
                // Store connector reference
                echo.connector = connector;
                echo.nats = connector;
                // Override Echo methods to use NATS connector
                echo.channel = (name) => {
                    return connector.channel(name);
                };
                echo.private = (name) => {
                    return connector.privateChannel(name);
                };
                echo.encryptedPrivate = (name) => {
                    return connector.encryptedPrivateChannel(name);
                };
                echo.join = (name) => {
                    return connector.join(name);
                };
                echo.leave = (name) => {
                    connector.leave(name);
                };
                echo.leaveChannel = echo.leave;
                echo.notification = (userId) => {
                    return connector.notification(userId);
                };
                echo.disconnect = () => {
                    connector.disconnect();
                };
                echo.socketId = () => {
                    return connector.socketId();
                };
                echo.on = (event, handler) => {
                    connector.on(event, handler);
                    return echo; // Allow chaining
                };
                echo.off = (event, handler) => {
                    connector.off(event, handler);
                    return echo; // Allow chaining
                };
                echo.listen = (channel, event, callback) => {
                    return connector.listen(channel, event, callback);
                };
                // Connect automatically
                connector.connect().catch((error) => {
                    var _a;
                    console.error('NATS Echo: Failed to connect', error);
                    (_a = echo.trigger) === null || _a === void 0 ? void 0 : _a.call(echo, 'error', error);
                });
                return echo;
            }
        };
    }
}

// Create the broadcaster object for Laravel Echo
const NatsBroadcaster = NatsConnector.asBroadcaster();
// Export for direct use without Laravel Echo
const createNatsEcho = (options = {}) => {
    return new NatsConnector(options);
};

exports.Channel = Channel;
exports.EncryptedPrivateChannel = EncryptedPrivateChannel;
exports.NatsBroadcaster = NatsBroadcaster;
exports.NatsConnector = NatsConnector;
exports.NatsEventFormatter = NatsEventFormatter;
exports.PresenceChannel = PresenceChannel;
exports.PrivateChannel = PrivateChannel;
exports.createNatsEcho = createNatsEcho;
exports.default = NatsBroadcaster;
//# sourceMappingURL=index.js.map
