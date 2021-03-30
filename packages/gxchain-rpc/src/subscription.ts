// import { uuidv4 } from 'uuid';
// import { Aborter, FunctionalMap, createStringFunctionalMap } from '@gxchain2/utils';

// function randomIDGenetator(): string {
//   return uuidv4();
// }

// type FilterQuery = {
//   BlockHash: Buffer;
//   FromBlock: number;
//   ToBlock: number;
//   Addresses: Buffer[];
//   Topics: Buffer[][];
// };

// type subscription = {
//   ID: string;
//   typ: string;
//   created: string;
//   namespace: string;
//   activated: boolean;
//   logsCrit: FilterQuery;
//   logs: Buffer[];
//   hashes: Buffer;
//   headers: Buffer;
// };

// // notify(id: string, data: any) {
// //   if (this.ID != id) {
// //     ws.send('Notify with wrong ID');
// //     return;
// //   }
// //   if (this.activated) {
// //     ws.send(JSON.stringify(data));
// //   }
// // }

// const deadline = 5 * 60 * 1000;
// type filter = {
//   type: string;
//   lifetime: number;
//   hashes: Buffer[];
//   logs: Buffer[];
//   queryInfo: FilterQuery;
//   notify: (data: any) => void;
// };

// class Filters {
//   private aborter = new Aborter();

//   private readonly initPromise: Promise<void>;

//   private readonly WsPendingTransactionsMap: FunctionalMap<string, filter>;
//   private readonly WsPendingLogsMap: FunctionalMap<string, filter>;
//   private readonly WsLogMap: FunctionalMap<string, filter>;
//   private readonly WsHeadMap: FunctionalMap<string, filter>;
//   private readonly HttpPendingTransactionsMap: FunctionalMap<string, filter>;
//   private readonly HttpPendingLogsMap: FunctionalMap<string, filter>;
//   private readonly HttpLogMap: FunctionalMap<string, filter>;
//   private readonly HttpHeadMap: FunctionalMap<string, filter>;

//   constructor() {
//     this.initPromise = this.init();
//     this.WsPendingTransactionsMap = createStringFunctionalMap<filter>();
//     this.WsPendingLogsMap = createStringFunctionalMap<filter>();
//     this.WsHeadMap = createStringFunctionalMap<filter>();
//     this.WsLogMap = createStringFunctionalMap<filter>();
//     this.HttpHeadMap = createStringFunctionalMap<filter>();
//     this.HttpPendingTransactionsMap = createStringFunctionalMap<filter>();
//     this.HttpPendingLogsMap = createStringFunctionalMap<filter>();
//     this.HttpLogMap = createStringFunctionalMap<filter>();

//     this.timeoutLoop();
//   }
//   async abort() {
//     await this.aborter.abort();
//   }

//   async init() {
//     if (this.initPromise) {
//       await this.initPromise;
//       return;
//     }
//   }

//   private async cycleDelete(map: FunctionalMap<any, any>) {
//     for await (const [key, filter] of map) {
//       if (Date.now() - filter.lifetime > deadline) {
//         map.delete(key);
//       }
//     }
//   }

//   private async timeoutLoop() {
//     await this.initPromise;
//     while (!this.aborter.isAborted) {
//       await this.aborter.abortablePromise(new Promise((r) => setTimeout(r, deadline)));
//       if (this.aborter.isAborted) {
//         break;
//       }
//       await this.cycleDelete(this.HttpLogMap);
//       await this.cycleDelete(this.HttpLogMap);
//       await this.cycleDelete(this.HttpPendingMap);
//     }
//   }

//   wsSubscibe(client: any, queryInfo: FilterQuery) {
//     // if queryInfo.type === 'PendingTransactions';
//     this.WsPendingTransactionsMap.set(client.id, 'filter' as any);
//   }

//   httpSubscribe(filter: any, queryInfo: FilterQuery) {
//     // if queryInfo.type === 'PendingTransactions';
//     this.HttpPendingTransactionsMap.set(filter.id, 'filter' as any);
//   }

//   httpFilterChanged(id: string, type: string) {
//     // if type === 'PendingTransactions';
//     const filterInfo = this.HttpPendingTransactionsMap.get(id);
//     return filterInfo?.logs; // or filterInfo.hashes
//     // ilterInfo?.logs = []
//   }

//   newPendingTransactions(hash: Buffer) {
//     for (const [id, filterInfo] of this.WsPendingTransactionsMap) {
//       // if (filterInfo.queryInfo) { 判断是否符合条件
//       // filterInfo.notify(...).
//     }
//     for (const [id, filterInfo] of this.HttpPendingTransactionsMap) {
//       // if (filterInfo.queryInfo) { 判断是否符合条件
//       // filterInfo.hashes.push(hash);
//     }
//   }
// }
