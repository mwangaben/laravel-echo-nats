import { PrivateChannel } from './channel';
import { Connector, PresenceChannel as IPresenceChannel } from './types';

export class PresenceChannel extends PrivateChannel implements IPresenceChannel {
    private members: Map<string | number, any> = new Map();
    private hereCallbacks: Function[] = [];
    private joiningCallbacks: Function[] = [];
    private leavingCallbacks: Function[] = [];

    constructor(connector: Connector, name: string, options: any = {}) {
        super(connector, 'presence-' + name, options);
    }

    public async subscribe(): Promise<this> {
        if (this.subscribed) {
            return this;
        }

        await super.subscribe();

        // Set up presence event listeners
        this.listen('presence:here', (users: any[]) => {
            this.updateMembers(users);
            this.triggerHere(users);
        });

        this.listen('presence:joining', (user: any) => {
            this.addMember(user);
            this.triggerJoining(user);
        });

        this.listen('presence:leaving', (user: any) => {
            this.removeMember(user);
            this.triggerLeaving(user);
        });

        return this;
    }

    public unsubscribe(): this {
        this.subscribed = false;
        return this;
    }

    public here(callback: (users: any[]) => void): this {
        this.hereCallbacks.push(callback);

        // Trigger immediately if we already have members
        if (this.members.size > 0) {
            callback(this.getMembers());
        }

        return this;
    }

    public joining(callback: (user: any) => void): this {
        this.joiningCallbacks.push(callback);
        return this;
    }

    public leaving(callback: (user: any) => void): this {
        this.leavingCallbacks.push(callback);
        return this;
    }

    public whisper(eventName: string, data: any): this {
        // Override parent whisper to include presence channel specific logic
        return super.whisper(eventName, data);
    }

    public getMembers(): any[] {
        return Array.from(this.members.values());
    }

    public getMember(userId: string | number): any | undefined {
        return this.members.get(userId);
    }

    private updateMembers(users: any[]): void {
        this.members.clear();
        users.forEach(user => {
            if (user.id || user.user_id) {
                const userId = user.id || user.user_id;
                this.members.set(userId, user);
            }
        });
    }

    private addMember(user: any): void {
        const userId = user.id || user.user_id;
        if (userId) {
            this.members.set(userId, user);
        }
    }

    private removeMember(user: any): void {
        const userId = user.id || user.user_id;
        if (userId) {
            this.members.delete(userId);
        }
    }

    private triggerHere(users: any[]): void {
        this.hereCallbacks.forEach(callback => {
            try {
                callback(users);
            } catch (error) {
                console.error('Error in here callback:', error);
            }
        });
    }

    private triggerJoining(user: any): void {
        this.joiningCallbacks.forEach(callback => {
            try {
                callback(user);
            } catch (error) {
                console.error('Error in joining callback:', error);
            }
        });
    }

    private triggerLeaving(user: any): void {
        this.leavingCallbacks.forEach(callback => {
            try {
                callback(user);
            } catch (error) {
                console.error('Error in leaving callback:', error);
            }
        });
    }

    // Handle presence-specific events from the connector
    public handlePresenceEvent(event: string, data: any): void {
        switch (event) {
            case 'presence:here':
                this.updateMembers(data);
                this.triggerHere(data);
                break;
            case 'presence:joining':
                this.addMember(data);
                this.triggerJoining(data);
                break;
            case 'presence:leaving':
                this.removeMember(data);
                this.triggerLeaving(data);
                break;
        }
    }
}