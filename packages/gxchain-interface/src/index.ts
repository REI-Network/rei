export interface Database {
    put(key: string, val: any): void;
    get(key: string): any;
    forEach(fn: (value: any, key: string, map: Map<string, any>) => void): void;
    updateLocalBlockHeight(height: number): void;
    getLocalBlockHeight(): number;
}

export interface Peer {
    getPeerId(): string;
    pipeWriteStream(stream: any): void;
    pipeReadStream(stream: any): void;
    isWriting(): boolean;
    isReading(): boolean;
    abort(): void;
    addToQueue(msgData: string, waiting?: boolean): void | Promise<void>;
    jsonRPCRequest(method: string, params?: any, timeout?: number): Promise<any>;
    jsonRPCNotify(method: string, params?: any, waiting?: false): void;
    jsonRPCNotify(method: string, params?: any, waiting?: true): Promise<void>;
    jsonRPCNotify(method: string, params?: any, waiting?: boolean): Promise<void> | void;
    jsonRPCReceiveMsg(data: any): void;
}

export interface P2P {
    libp2pNode: any;
    getPeer(id: string): Peer | undefined;
    forEachPeer(fn: (value: Peer, key: string, map: Map<string, Peer>) => void): void;
    getLocalPeerId(): string;
    init(): Promise<void>;
}

export interface Node {
    p2p: P2P;
    db: Database;
    init(): Promise<void>;
}