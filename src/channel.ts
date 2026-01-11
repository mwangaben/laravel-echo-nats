import { Connector } from './types';

export class Channel {
    constructor(
        protected connector: Connector,
        protected name: string,
        protected options: any = {}
    ) {}

    listen(event: string, callback: Function): this {
        this.connector.listen(this.name, event, callback);
        return this;
    }

    notification(callback: Function): this {
        return this.listen(
            'Illuminate\\Notifications\\Events\\BroadcastNotificationCreated',
            callback
        );
    }

    listenForWhisper(event: string, callback: Function): this {
        return this.listen('.client-' + event, callback);
    }

    stopListening(event: string): this {
        // Implementation depends on connector
        return this;
    }
}

export class PrivateChannel extends Channel {
    constructor(connector: Connector, name: string, options: any = {}) {
        super(connector, 'private-' + name, options);
    }
}

export class EncryptedPrivateChannel extends Channel {
    constructor(connector: Connector, name: string, options: any = {}) {
        super(connector, 'private-encrypted-' + name, options);
    }
}

export class PresenceChannel extends Channel {
    constructor(connector: Connector, name: string, options: any = {}) {
        super(connector, 'presence-' + name, options);
    }

    here(callback: Function): this {
        return this.listen('presence:here', callback);
    }

    joining(callback: Function): this {
        return this.listen('presence:joining', callback);
    }

    leaving(callback: Function): this {
        return this.listen('presence:leaving', callback);
    }
}