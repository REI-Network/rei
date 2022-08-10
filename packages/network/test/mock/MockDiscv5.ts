import EventEmitter from 'events';
import { ENR } from '@gxchain2/discv5';
import { IDiscv5 } from '../../src/types';
import { NetworkService } from './NetworkService';
import { MockDiscv5Config, localhost } from './MockConfig';
export class MockDiscv5 extends EventEmitter implements IDiscv5 {
  //广播管理对象
  private networkService: NetworkService;
  //discv5配置对象
  private config: MockDiscv5Config;
  //本地节点ENR
  private enr: ENR;
  //已发现的节点集合
  private nodes: Map<string, ENR> = new Map();
  //节点发现定时器(在指定时间间隔内搜索节点)
  private lookupTimer: NodeJS.Timer | undefined;
  //节点保活定时器(在指定时间间隔内向所有已发现节点发ping)
  private keepLiveTimer: NodeJS.Timer | undefined;
  //节点状态变量
  private isAbort: boolean = false;
  //是否启动状态变量
  private isStart: boolean = false;
  //初始化各属性并将boot节点加入nodes中
  constructor(config: MockDiscv5Config, enr: ENR, bootNodes: string[], networkService: NetworkService) {
    super();
    this.enr = enr;
    this.config = config;
    this.networkService = networkService;
    for (const enrStr of bootNodes) {
      this.addEnr(enrStr);
    }
    this.networkService.registerNode(this);
  }

  //返回本地节点ENR
  get localEnr(): ENR {
    return this.enr;
  }

  //添加节点ENR到nodes(已发现节点集合)中
  addEnr(enr: string | ENR): void {
    const enrObj = enr instanceof ENR ? enr : ENR.decodeTxt(enr);
    this.handleEnr(enrObj);
  }

  //从nodes(已发现节点集合)中获取节点ENR
  findEnr(nodeId: string): ENR | undefined {
    return this.nodes.get(nodeId);
  }

  //启动节点(1.启动搜索节点服务 2.启动节点保活服务)
  start(): void {
    if (this.isStart) {
      return;
    }
    this.isStart = true;
    this.lookup();
    this.keepAlive();
  }

  //停止节点(1.删除搜索节点定时器 2.删除节点保活定时器 3.删除发现节点集合 4.节点状态变量isAbort设置为true)
  stop(): void {
    if (this.isAbort) {
      return;
    }
    this.isAbort = true;
    this.lookupTimer && clearInterval(this.lookupTimer);
    this.keepLiveTimer && clearInterval(this.keepLiveTimer);
    this.nodes.clear();
  }

  //将新节点加入发现集合中并触发'peer'事件通知外部
  private async handleEnr(enr: ENR) {
    if (enr.peerId === this.enr.peerId || enr.ip == localhost) {
      return;
    }
    if (!this.nodes.has(enr.nodeId) || enr.seq > this.nodes.get(enr.nodeId)!.seq) {
      //更新节点
      this.nodes.set(enr.nodeId, enr);
    }
    const multiaddr = enr.getLocationMultiaddr('tcp');
    if (!multiaddr) {
      return;
    }
    this.emit('peer', {
      id: await enr.peerId(),
      multiaddrs: [multiaddr]
    });
  }

  //搜索节点服务(1.初始化lookUp定时器 2.调用networkService的lookup函数获取指定node的已发现节点 3.处理返回的ENR集合)
  private lookup() {
    this.lookupTimer = setInterval(async () => {
      if (this.isAbort) {
        return;
      }
      const localEnr = this.deepCopy(this.localEnr);
      for (const enr of this.nodes.values()) {
        const enrs = await this.networkService.lookup(localEnr, enr.nodeId);
        if (enrs) {
          for (const enr of enrs) {
            this.handleEnr(enr);
          }
        }
      }
    }, this.config.lookupInterval ?? 2000);
  }

  //节点保活服务(1.初始化保活定时器 2.调用networkService的sendPing函数向所有已发现节点发ping请求)
  private keepAlive() {
    this.keepLiveTimer = setInterval(() => {
      if (this.isAbort) {
        return;
      }
      for (const enr of this.nodes.values()) {
        this.networkService.sendPing(this.enr.nodeId, enr.nodeId);
      }
    }, this.config.keepAliveInterval ?? 5000);
  }

  //处理发现节点请求(1.处理请求方的最新ENR地址 2.返回本地最新ENR和所有已发现节点)
  async handleFindNode(sourceEnr: ENR) {
    await this.handleEnr(sourceEnr);
    return [this.enr, ...this.nodes.values()].map((e) => this.deepCopy(e));
  }

  //处理ping message请求(调用networkService的sendPong函数向请求方发送pong消息)
  handlePing(callerId: string) {
    this.networkService.sendPong(callerId);
  }

  //处理pong message(判断本地enr的ip是否为localhost，若是则将ip更新并触发'multiaddr'事件通知外部)
  handlePong(ip: string) {
    if (ip && this.enr.ip != ip) {
      this.enr.ip = ip;
      this.emit('multiaddr', this.localEnr.getLocationMultiaddr('udp'));
    }
  }

  //深拷贝enr
  private deepCopy(enr: ENR) {
    return ENR.decodeTxt(enr.encodeTxt());
  }
}
