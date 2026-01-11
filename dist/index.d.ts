import { NatsConnector } from './connector';
import { Channel, PrivateChannel, EncryptedPrivateChannel, PresenceChannel } from './channel';
import { NatsEchoOptions } from './types';
declare const NatsBroadcaster: {
    install(echo: any, options?: NatsEchoOptions): any;
};
export { NatsConnector, NatsBroadcaster, Channel, PrivateChannel, EncryptedPrivateChannel, PresenceChannel };
export type { NatsEchoOptions };
export default NatsBroadcaster;
