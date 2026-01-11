import { EventFormatter } from './types';
export declare class NatsEventFormatter implements EventFormatter {
    private namespace;
    constructor(namespace?: string);
    format(namespace: string, event: string): string;
    setNamespace(namespace: string): void;
    getNamespace(): string;
    belongsToNamespace(eventName: string): boolean;
    getEventNameWithoutNamespace(eventName: string): string;
}
