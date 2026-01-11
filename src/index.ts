import { NatsConnector } from './connector';
import { Channel, PrivateChannel, EncryptedPrivateChannel, PresenceChannel } from './channel';
import { NatsEchoOptions } from './types';

// Main plugin for Laravel Echo
const NatsBroadcaster = {
    install(echo: any, options: NatsEchoOptions = {}) {
        const connector = new NatsConnector(options);

        // Override Echo's connector methods
        echo.connector = connector;

        // Add shortcut methods to Echo instance
        echo.nats = connector;

        // Override channel methods
        const originalChannel = echo.channel.bind(echo);
        const originalPrivate = echo.private.bind(echo);
        const originalEncryptedPrivate = echo.encryptedPrivate.bind(echo);
        const originalJoin = echo.join.bind(echo);

        echo.channel = (name: string) => {
            return connector.channel(name);
        };

        echo.private = (name: string) => {
            return connector.privateChannel(name);
        };

        echo.encryptedPrivate = (name: string) => {
            return connector.encryptedPrivateChannel(name);
        };

        echo.join = (name: string) => {
            return connector.join(name);
        };

        echo.leave = (name: string) => {
            return connector.leave(name);
        };

        echo.leaveChannel = echo.leave;

        // Connect automatically
        connector.connect().catch((error: Error) => {
            console.error('NATS Echo: Failed to connect', error);
        });

        return echo;
    }
};

// Export everything
export { NatsConnector, NatsBroadcaster, Channel, PrivateChannel, EncryptedPrivateChannel, PresenceChannel };
export type { NatsEchoOptions };
export default NatsBroadcaster;