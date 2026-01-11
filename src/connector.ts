import { connect, JSONCodec, NatsConnection, Subscription } from 'nats.ws';
import { NatsEchoOptions, Connector } from './types';
import { Channel, PrivateChannel, EncryptedPrivateChannel, PresenceChannel } from './channel';

export class NatsConnector implements Connector {
    private options: NatsEchoOptions;
    private natsConnection: NatsConnection | null = null;
    private jsonCodec = JSONCodec();
    private subscriptions: Map<string, Subscription> = new Map();
    private eventCallbacks: Map<string, Map<string, Function[]>> = new Map();
    private readonly currentSocketId: string;  // Rename this to avoid conflict
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private isConnecting = false;
    private connectionPromise: Promise<void> | null = null;

    constructor(options: NatsEchoOptions = {}) {
        this.options = {
            host: 'ws://localhost:4222',
            timeout: 5000,
            prefix: '',
            reconnects: 5,
            debug: false,
            namespace: 'App.Events',
            ...options
        };

        this.currentSocketId = this.generateSocketId();
    }

    private generateSocketId(): string {
        return 'nats_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    }

    async connect(): Promise<void> {
        if (this.connectionPromise) {
            return this.connectionPromise;
        }

        this.connectionPromise = this.establishConnection();
        return this.connectionPromise;
    }

    private async establishConnection(): Promise<void> {
        if (this.isConnecting || this.natsConnection) {
            return;
        }

        this.isConnecting = true;

        try {
            const servers = this.options.servers || this.options.host;

            if (this.options.debug) {
                console.log('NATS Echo: Connecting to', servers);
            }

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

            // Resubscribe to any existing channels
            await this.resubscribeAll();
        } catch (error) {
            console.error('NATS Echo: Connection failed', error);
            throw error;
        } finally {
            this.isConnecting = false;
            this.connectionPromise = null;
        }
    }

    private setupConnectionEvents(): void {
        if (!this.natsConnection) return;

        this.natsConnection.closed()
            .then(() => {
                if (this.options.debug) {
                    console.log('NATS Echo: Connection closed');
                }
                this.natsConnection = null;
            })
            .catch(err => {
                console.error('NATS Echo: Connection closed with error', err);
                this.natsConnection = null;
            });

        (async () => {
            // @ts-ignore
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
        })();
    }

    private async resubscribeAll(): Promise<void> {
        const subjects = Array.from(this.subscriptions.keys());

        // Clear old subscriptions
        this.subscriptions.forEach(sub => sub.unsubscribe());
        this.subscriptions.clear();

        // Resubscribe to all subjects
        for (const subject of subjects) {
            await this.subscribeToSubject(subject);
        }
    }

    private async subscribeToSubject(subject: string): Promise<void> {
        if (!this.natsConnection) {
            await this.connect();
        }

        if (this.subscriptions.has(subject)) {
            return;
        }

        try {
            const subscription = this.natsConnection!.subscribe(subject, {
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

    private getSubjectFromChannel(channel: string): string {
        // Convert Laravel channel format to NATS subject
        let subject = channel.replace(/\./g, '-');

        // Add prefix if configured
        if (this.options.prefix) {
            subject = `${this.options.prefix}.${subject}`;
        }

        return subject;
    }

    private handleIncomingMessage(data: any, subject: string): void {
        if (this.options.debug) {
            console.log('NATS Echo: Received message', data, 'on subject', subject);
        }

        const channel = data.channel;
        let event = data.event;

        if (!event || !channel) {
            if (this.options.debug) {
                console.warn('NATS Echo: Received message without event or channel', data);
            }
            return;
        }

        // Format event name according to Laravel Echo conventions
        if (this.options.namespace && event.startsWith(this.options.namespace + '.')) {
            event = event.substring(this.options.namespace.length + 1);
        }

        // Add dot prefix for Echo
        const formattedEvent = event.startsWith('.') ? event : `.${event}`;

        const channelCallbacks = this.eventCallbacks.get(channel);
        if (!channelCallbacks) return;

        const callbacks = channelCallbacks.get(formattedEvent) || channelCallbacks.get(event) || [];

        callbacks.forEach(callback => {
            try {
                callback(data.data || data);
            } catch (error) {
                console.error(`NATS Echo: Error in callback for ${channel}@${event}`, error);
            }
        });
    }

    listen(channel: string, event: string, callback: Function): void {
        const subject = this.getSubjectFromChannel(channel);

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

    channel(name: string): Channel {
        return new Channel(this, name);
    }

    privateChannel(name: string): PrivateChannel {
        return new PrivateChannel(this, name);
    }

    encryptedPrivateChannel(name: string): EncryptedPrivateChannel {
        return new EncryptedPrivateChannel(this, name);
    }

    join(name: string): PresenceChannel {
        return new PresenceChannel(this, name);
    }

    leave(channel: string): void {
        const channelCallbacks = this.eventCallbacks.get(channel);
        if (!channelCallbacks) return;

        // Find and unsubscribe from all subjects for this channel
        for (const [subject, subscription] of this.subscriptions.entries()) {
            if (subject.startsWith(this.getSubjectFromChannel(channel))) {
                subscription.unsubscribe();
                this.subscriptions.delete(subject);
            }
        }

        this.eventCallbacks.delete(channel);
    }

    // Fix: This should be a method, not a property
    socketId(): string {
        return this.currentSocketId;
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