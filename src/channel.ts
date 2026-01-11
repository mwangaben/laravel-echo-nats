import { Connector, Channel as IChannel } from './types';

export abstract class BaseChannel implements IChannel {
    protected listeners: Record<string, Function[]> = {};
    protected subscribed: boolean = false;
    protected subscriptionId: string = '';

    constructor(
        protected connector: Connector,
        protected name: string,
        protected options: any = {}
    ) {
        this.generateSubscriptionId();
    }

    protected generateSubscriptionId(): void {
        this.subscriptionId = 'sub_' + Math.random().toString(36).substr(2, 9);
    }

    public async subscribe(): Promise<this> {
        if (this.subscribed) {
            return this;
        }

        try {
            // Use the connector's subscribe method
            await (this.connector as any).subscribeChannel(this);
            this.subscribed = true;
        } catch (error) {
            console.error(`Failed to subscribe to channel ${this.name}:`, error);
            throw error;
        }

        return this;
    }

    public unsubscribe(): this {
        if (!this.subscribed) {
            return this;
        }

        try {
            // Use the connector's unsubscribe method
            (this.connector as any).unsubscribeChannel(this);
            this.subscribed = false;
            this.listeners = {};
        } catch (error) {
            console.error(`Failed to unsubscribe from channel ${this.name}:`, error);
        }

        return this;
    }

    public listen(event: string, callback: Function): this {
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

    public notification(callback: Function): this {
        return this.listen(
            'Illuminate\\Notifications\\Events\\BroadcastNotificationCreated',
            callback
        );
    }

    public listenForWhisper(event: string, callback: Function): this {
        return this.listen('.client-' + event, callback);
    }

    public stopListening(event?: string, callback?: Function): this {
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
        } else {
            delete this.listeners[event];
        }

        // Unsubscribe if no listeners left
        if (Object.keys(this.listeners).length === 0) {
            this.unsubscribe();
        }

        return this;
    }

    public getName(): string {
        return this.name;
    }

    public isSubscribed(): boolean {
        return this.subscribed;
    }

    public getListeners(event?: string): Function[] {
        if (event) {
            return this.listeners[event] || [];
        }
        // Flatten all listeners
        return Object.values(this.listeners).reduce((acc, val) => acc.concat(val), []);
    }

    public trigger(event: string, data: any): void {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in channel ${this.name} event handler for "${event}":`, error);
                }
            });
        }

        // Also trigger wildcard listeners
        if (this.listeners['*']) {
            this.listeners['*'].forEach(callback => {
                try {
                    callback(event, data);
                } catch (error) {
                    console.error(`Error in channel ${this.name} wildcard handler for "${event}":`, error);
                }
            });
        }
    }
}

export class Channel extends BaseChannel {
    // Base channel implementation is complete
}

export class PrivateChannel extends BaseChannel {
    constructor(connector: Connector, name: string, options: any = {}) {
        super(connector, 'private-' + name, options);
    }

    public async subscribe(): Promise<this> {
        // For private channels, authenticate first
        try {
            await (this.connector as any).authenticatePrivateChannel(this.name);
            return await super.subscribe();
        } catch (error) {
            console.error(`Authentication failed for private channel ${this.name}:`, error);
            throw error;
        }
    }

    public whisper(eventName: string, data: any): this {
        // Send whisper through connector
        const whisperSubject = `${this.name}.whisper.${eventName}`;
        (this.connector as any).send(whisperSubject, data);
        return this;
    }
}

export class EncryptedPrivateChannel extends PrivateChannel {
    constructor(connector: Connector, name: string, options: any = {}) {
        super(connector, 'private-encrypted-' + name, options);
    }
}