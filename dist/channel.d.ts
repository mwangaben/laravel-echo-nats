import { Connector, Channel as IChannel } from './types';
export declare abstract class BaseChannel implements IChannel {
    protected connector: Connector;
    protected name: string;
    protected options: any;
    protected listeners: Record<string, Function[]>;
    protected subscribed: boolean;
    protected subscriptionId: string;
    constructor(connector: Connector, name: string, options?: any);
    protected generateSubscriptionId(): void;
    subscribe(): Promise<this>;
    unsubscribe(): this;
    listen(event: string, callback: Function): this;
    notification(callback: Function): this;
    listenForWhisper(event: string, callback: Function): this;
    stopListening(event?: string, callback?: Function): this;
    getName(): string;
    isSubscribed(): boolean;
    getListeners(event?: string): Function[];
    trigger(event: string, data: any): void;
}
export declare class Channel extends BaseChannel {
}
export declare class PrivateChannel extends BaseChannel {
    constructor(connector: Connector, name: string, options?: any);
    subscribe(): Promise<this>;
    whisper(eventName: string, data: any): this;
}
export declare class EncryptedPrivateChannel extends PrivateChannel {
    constructor(connector: Connector, name: string, options?: any);
}
