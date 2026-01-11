export interface NatsEchoOptions {
    host?: string;
    servers?: string | string[];
    user?: string;
    pass?: string;
    token?: string;
    timeout?: number;
    prefix?: string;
    reconnects?: number;
    debug?: boolean;
    authEndpoint?: string;
    broadcaster?: 'nats';
    namespace?: string;
}
export interface EventFormatter {
    format(namespace: string, event: string): string;
}
export interface Connector {
    connect(): void;
    listen(channel: string, event: string, callback: Function): void;
    channel(channel: string): any;
    privateChannel(channel: string): any;
    encryptedPrivateChannel(channel: string): any;
    join(channel: string): any;
    leave(channel: string): void;
    socketId(): string;
    disconnect(): void;
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
