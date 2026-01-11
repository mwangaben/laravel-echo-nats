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
    csrfToken?: string;
    wsPort?: number;
    wsPath?: string;
    useTLS?: boolean;
    forceTLS?: boolean;
    maxReconnectAttempts?: number;
    reconnectDelay?: number;
    disableStats?: boolean;
    transports?: string[];
    enabledTransports?: string[];
    auth?: {
        headers?: Record<string, string>;
        params?: Record<string, string>;
    };
    [key: string]: any;
}
export interface EventFormatter {
    format(namespace: string, event: string): string;
    setNamespace(namespace: string): void;
    getNamespace(): string;
}
export interface Connector {
    connect(): Promise<void>;
    disconnect(): void;
    listen(channel: string, event: string, callback: Function): Channel;
    channel(channel: string): Channel;
    privateChannel(channel: string): Channel;
    encryptedPrivateChannel(channel: string): Channel;
    join(channel: string): PresenceChannel;
    leave(channel: string): void;
    on(event: string, handler: Function): void;
    off(event: string, handler?: Function): void;
    socketId(): string;
    isConnected(): boolean;
    notification(userId: string | number): Channel;
}
export interface Channel {
    listen(event: string, callback: Function): Channel;
    notification(callback: Function): Channel;
    listenForWhisper(event: string, callback: Function): Channel;
    stopListening(event?: string, callback?: Function): Channel;
    subscribe(): Promise<Channel>;
    unsubscribe(): Channel;
    getName(): string;
    isSubscribed(): boolean;
    getListeners(event?: string): Function[];
    trigger(event: string, data: any): void;
}
export interface PresenceChannel extends Channel {
    here(callback: (users: any[]) => void): PresenceChannel;
    joining(callback: (user: any) => void): PresenceChannel;
    leaving(callback: (user: any) => void): PresenceChannel;
    whisper(eventName: string, data: any): PresenceChannel;
    getMembers(): any[];
    getMember(userId: string | number): any | undefined;
}
export interface BroadcastEvent {
    event: string;
    data: any;
    channel: string | {
        name: string;
    };
    socket?: string | null;
    timestamp?: string;
}
export interface AuthResponse {
    auth: string;
    channel_data?: any;
    socket_id?: string;
}
export interface Subscription {
    sid: string;
    channel: Channel;
    listeners: Record<string, Function[]>;
}
