export interface NatsEchoOptions {
    // Connection options
    host?: string;
    servers?: string | string[];
    user?: string;
    pass?: string;
    token?: string;
    timeout?: number;
    prefix?: string;
    reconnects?: number;
    debug?: boolean;

    // Laravel Echo compatibility
    authEndpoint?: string;
    broadcaster?: 'nats';
    namespace?: string;
    csrfToken?: string;

    // WebSocket options
    wsPort?: number;
    wsPath?: string;
    useTLS?: boolean;
    forceTLS?: boolean;

    // Advanced options
    maxReconnectAttempts?: number;
    reconnectDelay?: number;
    disableStats?: boolean;
    transports?: string[];
    enabledTransports?: string[];

    // Auth options
    auth?: {
        headers?: Record<string, string>;
        params?: Record<string, string>;
    };

    // Custom options
    [key: string]: any;
}

export interface EventFormatter {
    format(namespace: string, event: string): string;
    setNamespace(namespace: string): void;
    getNamespace(): string;
}

export interface Connector {
    // Core methods
    connect(): Promise<void>;
    disconnect(): void;

    // Channel methods
    listen(channel: string, event: string, callback: Function): Channel;
    channel(channel: string): Channel;
    privateChannel(channel: string): Channel;
    encryptedPrivateChannel(channel: string): Channel;
    join(channel: string): PresenceChannel;
    leave(channel: string): void;

    // Event handling
    on(event: string, handler: Function): void;
    off(event: string, handler?: Function): void;

    // Connection info
    socketId(): string;
    isConnected(): boolean;

    // Laravel Echo compatibility
    notification(userId: string | number): Channel;
}

export interface Channel {
    // Event listening
    listen(event: string, callback: Function): Channel;
    notification(callback: Function): Channel;
    listenForWhisper(event: string, callback: Function): Channel;
    stopListening(event?: string, callback?: Function): Channel;

    // Subscription control
    subscribe(): Promise<Channel>;
    unsubscribe(): Channel;

    // Channel info
    getName(): string;
    isSubscribed(): boolean;

    // Internal methods (for connector)
    getListeners(event?: string): Function[];
    trigger(event: string, data: any): void;
}

export interface PresenceChannel extends Channel {
    // Presence specific methods
    here(callback: (users: any[]) => void): PresenceChannel;
    joining(callback: (user: any) => void): PresenceChannel;
    leaving(callback: (user: any) => void): PresenceChannel;
    whisper(eventName: string, data: any): PresenceChannel;

    // Member management
    getMembers(): any[];
    getMember(userId: string | number): any | undefined;
}

export interface BroadcastEvent {
    event: string;
    data: any;
    channel: string | { name: string };
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
