import { Connector } from './types';
export declare class Channel {
    protected connector: Connector;
    protected name: string;
    protected options: any;
    constructor(connector: Connector, name: string, options?: any);
    listen(event: string, callback: Function): this;
    notification(callback: Function): this;
    listenForWhisper(event: string, callback: Function): this;
    stopListening(event: string): this;
}
export declare class PrivateChannel extends Channel {
    constructor(connector: Connector, name: string, options?: any);
}
export declare class EncryptedPrivateChannel extends Channel {
    constructor(connector: Connector, name: string, options?: any);
}
export declare class PresenceChannel extends Channel {
    constructor(connector: Connector, name: string, options?: any);
    here(callback: Function): this;
    joining(callback: Function): this;
    leaving(callback: Function): this;
}
