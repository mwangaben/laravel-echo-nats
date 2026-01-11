import { EventFormatter } from './types';

export class NatsEventFormatter implements EventFormatter {
    private namespace: string = 'App\\Events';

    constructor(namespace?: string) {
        if (namespace) {
            this.namespace = namespace;
        }
    }

    format(namespace: string, event: string): string {
        // If event is already namespaced, return as is
        if (event.startsWith(namespace)) {
            return event;
        }

        // Format: Namespace\EventName
        return namespace + '\\' + event;
    }

    setNamespace(namespace: string): void {
        this.namespace = namespace;
    }

    getNamespace(): string {
        return this.namespace;
    }

    // Helper to check if event belongs to namespace
    belongsToNamespace(eventName: string): boolean {
        return eventName.startsWith(this.namespace);
    }

    // Extract event name without namespace
    getEventNameWithoutNamespace(eventName: string): string {
        if (this.belongsToNamespace(eventName)) {
            // Remove namespace and leading backslash
            return eventName.substring(this.namespace.length + 1);
        }
        return eventName;
    }
}