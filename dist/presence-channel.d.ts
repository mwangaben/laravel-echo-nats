import { PrivateChannel } from './channel';
import { Connector, PresenceChannel as IPresenceChannel } from './types';
export declare class PresenceChannel extends PrivateChannel implements IPresenceChannel {
    private members;
    private hereCallbacks;
    private joiningCallbacks;
    private leavingCallbacks;
    constructor(connector: Connector, name: string, options?: any);
    subscribe(): Promise<this>;
    unsubscribe(): this;
    here(callback: (users: any[]) => void): this;
    joining(callback: (user: any) => void): this;
    leaving(callback: (user: any) => void): this;
    whisper(eventName: string, data: any): this;
    getMembers(): any[];
    getMember(userId: string | number): any | undefined;
    private updateMembers;
    private addMember;
    private removeMember;
    private triggerHere;
    private triggerJoining;
    private triggerLeaving;
    handlePresenceEvent(event: string, data: any): void;
}
