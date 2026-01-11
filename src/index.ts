import { NatsConnector } from './connector';
import { Channel, PrivateChannel, EncryptedPrivateChannel } from './channel';
import { PresenceChannel } from './presence-channel';
import { NatsEventFormatter } from './event-formatter';
import { NatsEchoOptions, Connector } from './types';

// Create the broadcaster object for Laravel Echo
const NatsBroadcaster = NatsConnector.asBroadcaster();

// Export for direct use without Laravel Echo
export const createNatsEcho = (options: NatsEchoOptions = {}): Connector => {
    return new NatsConnector(options);
};

// Named exports
export {
    NatsConnector,
    NatsBroadcaster,
    Channel,
    PrivateChannel,
    EncryptedPrivateChannel,
    PresenceChannel,
    NatsEventFormatter
};

// Type exports
export type { NatsEchoOptions, Connector };

// Default export (Laravel Echo plugin)
export default NatsBroadcaster;