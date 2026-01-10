import Echo from 'laravel-echo';
import { connect, JSONCodec, NatsConnection, Subscription } from 'nats.ws';

declare global {
    interface Window {
        Echo: any;
    }
}

export interface NatsOptions {
    host?: string;
    servers?: string | string[];
    user?: string;
    pass?: string;
    token?: string;
    timeout?: number;
    prefix?: string;
    reconnects?: number;
    debug?: boolean;
}

export interface Channel {
    listen(event: string, callback: Function): Channel;
    notification(callback: Function): Channel;
    listenForWhisper(event: string, callback: Function): Channel;
    stopListening(event: string): Channel;
}

export interface PresenceChannel extends Channel {
    here(callback: Function): PresenceChannel;
    joining(callback: Function): PresenceChannel;
    leaving(callback: Function): PresenceChannel;
}

class NatsConnector {
    private options: NatsOptions;
    private natsConnection: NatsConnection | null = null;
    private jsonCodec = JSONCodec();
    private subscriptions: Map<string, Subscription> = new Map();
    private eventCallbacks: Map<string, Map<string, Function[]>> = new Map();
    private socketId: string;
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;

    constructor(options: NatsOptions = {}) {
        this.options = {
            host: 'ws://localhost:4222',
            timeout: 5000,
            prefix: '',
            reconnects: 5,
            debug: false,
            ...options
        };

        this.socketId = this.generateSocketId();
    }

    private generateSocketId(): string {
        return 'nats_' + Math.random().toString(36).substr(2, 9);
    }

    async connect(): Promise<void> {
        try {
            const servers = this.options.servers || this.options.host;

            this.natsConnection = await connect({
                servers: servers,
                user: this.options.user,
                pass: this.options.pass,
                token: this.options.token,
                timeout: this.options.timeout,
                reconnect: true,
                maxReconnectAttempts: this.options.reconnects,
                waitOnFirstConnect: true,
            });

            this.setupConnectionEvents();

            if (this.options.debug) {
                console.log('NATS Echo: Connected successfully');
            }
        } catch (error) {
            console.error('NATS Echo: Connection failed', error);
            throw error;
        }
    }

    private setupConnectionEvents(): void {
        if (!this.natsConnection) return;

        this.natsConnection.closed()
            .then(() => {
                if (this.options.debug) {
                    console.log('NATS Echo: Connection closed');
                }
            })
            .catch(err => {
                console.error('NATS Echo: Connection closed with error', err);
            });

        // Listen for connection status changes
        for await (const status of this.natsConnection.status()) {
            if (this.options.debug) {
                console.log('NATS Echo: Connection status:', status.type);
            }

            if (status.type === 'disconnect' || status.type === 'error') {
                this.reconnectAttempts++;

                if (this.reconnectAttempts > this.maxReconnectAttempts) {
                    console.error('NATS Echo: Max reconnection attempts reached');
                    this.cleanup();
                }
            } else if (status.type === 'reconnect') {
                this.reconnectAttempts = 0;
                this.resubscribeAll();
            }
        }
    }

    private async resubscribeAll(): Promise<void> {
        const oldSubscriptions = Array.from(this.subscriptions.entries());

        this.subscriptions.clear();

        for (const [subject, subscription] of oldSubscriptions) {
            await this.subscribeToSubject(subject);
        }
    }

    private async subscribeToSubject(subject: string): Promise<void> {
        if (!this.natsConnection || this.subscriptions.has(subject)) {
            return;
        }

        try {
            const subscription = this.natsConnection.subscribe(subject, {
                callback: (err, msg) => {
                    if (err) {
                        console.error('NATS Echo: Subscription error', err);
                        return;
                    }

                    try {
                        const data = this.jsonCodec.decode(msg.data);
                        this.handleIncomingMessage(data, subject);
                    } catch (e) {
                        console.error('NATS Echo: Failed to decode message', e);
                    }
                }
            });

            this.subscriptions.set(subject, subscription);

            if (this.options.debug) {
                console.log(`NATS Echo: Subscribed to ${subject}`);
            }
        } catch (error) {
            console.error(`NATS Echo: Failed to subscribe to ${subject}`, error);
        }
    }

    private getSubjectFromChannel(channel: string, event?: string): string {
        let subject = channel;

        // Add prefix if set
        if (this.options.prefix) {
            subject = `${this.options.prefix}.${subject}`;
        }

        // Convert Laravel channel format to NATS subject
        subject = subject.replace(/\./g, '-');

        if (event && event !== '*') {
            subject = `${subject}.${event}`;
        }

        return subject;
    }

    private getChannelFromSubject(subject: string): string {
        let channel = subject;

        // Remove prefix
        if (this.options.prefix) {
            const prefix = `${this.options.prefix}.`;
            if (channel.startsWith(prefix)) {
                channel = channel.substring(prefix.length);
            }
        }

        // Convert back to Laravel channel format
        channel = channel.replace(/-/g, '.');

        return channel;
    }

    private handleIncomingMessage(data: any, subject: string): void {
        const channel = this.getChannelFromSubject(subject.split('.')[0]);
        const event = data.event;

        if (!event) {
            if (this.options.debug) {
                console.warn('NATS Echo: Received message without event', data);
            }
            return;
        }

        const channelCallbacks = this.eventCallbacks.get(channel);
        if (!channelCallbacks) return;

        const callbacks = channelCallbacks.get(event) || [];

        callbacks.forEach(callback => {
            try {
                callback(data.data);
            } catch (error) {
                console.error(`NATS Echo: Error in callback for ${channel}@${event}`, error);
            }
        });
    }

    listen(channel: string, event: string, callback: Function): void {
        const subject = this.getSubjectFromChannel(channel, event);

        if (!this.eventCallbacks.has(channel)) {
            this.eventCallbacks.set(channel, new Map());
        }

        const channelCallbacks = this.eventCallbacks.get(channel)!;

        if (!channelCallbacks.has(event)) {
            channelCallbacks.set(event, []);
        }

        channelCallbacks.get(event)!.push(callback);

        this.subscribeToSubject(subject);
    }

    channel(channel: string): Channel {
        return {
            listen: (event: string, callback: Function) => {
                this.listen(channel, event, callback);
                return this;
            },
            notification: (callback: Function) => {
                this.listen(channel, 'Illuminate\\Notifications\\Events\\BroadcastNotificationCreated', callback);
                return this;
            },
            listenForWhisper: (event: string, callback: Function) => {
                const whisperEvent = `client-${event}`;
                this.listen(channel, whisperEvent, callback);
                return this;
            },
            stopListening: (event: string) => {
                const channelCallbacks = this.eventCallbacks.get(channel);
                if (channelCallbacks) {
                    channelCallbacks.delete(event);
                }
                return this;
            }
        };
    }

    privateChannel(channel: string): Channel {
        return this.channel(`private-${channel}`);
    }

    encryptedPrivateChannel(channel: string): Channel {
        return this.channel(`private-encrypted-${channel}`);
    }

    join(channel: string): PresenceChannel {
        const presenceChannel = this.channel(`presence-${channel}`);

        return {
            ...presenceChannel,
            here: (callback: Function) => {
                this.listen(`presence-${channel}`, 'presence:here', callback);
                return this;
            },
            joining: (callback: Function) => {
                this.listen(`presence-${channel}`, 'presence:joining', callback);
                return this;
            },
            leaving: (callback: Function) => {
                this.listen(`presence-${channel}`, 'presence:leaving', callback);
                return this;
            }
        };
    }

    leave(channel: string): void {
        const channelCallbacks = this.eventCallbacks.get(channel);
        if (!channelCallbacks) return;

        // Unsubscribe from all events for this channel
        for (const [event] of channelCallbacks) {
            const subject = this.getSubjectFromChannel(channel, event);
            const subscription = this.subscriptions.get(subject);

            if (subscription) {
                subscription.unsubscribe();
                this.subscriptions.delete(subject);
            }
        }

        this.eventCallbacks.delete(channel);
    }

    socketId(): string {
        return this.socketId;
    }

    disconnect(): void {
        this.cleanup();
    }

    private cleanup(): void {
        // Unsubscribe all
        this.subscriptions.forEach(subscription => {
            subscription.unsubscribe();
        });

        this.subscriptions.clear();
        this.eventCallbacks.clear();

        // Close connection
        if (this.natsConnection) {
            this.natsConnection.close();
            this.natsConnection = null;
        }
    }
}

// Plugin for Laravel Echo
const NatsBroadcaster = {
    install(echo: any, options: NatsOptions = {}) {
        const connector = new NatsConnector(options);

        echo.connector = connector;

        // Add connector methods to Echo instance
        echo.connector = connector;
        echo.nats = connector;

        // Initialize connection
        connector.connect().catch(console.error);
    }
};

// Export for CommonJS and ES modules
export { NatsConnector, NatsBroadcaster };
export default NatsBroadcaster;