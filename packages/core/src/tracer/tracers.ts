export const fourByteTracer = `{
  // ids aggregates the 4byte ids found.
  ids: {},

  // callType returns 'false' for non-calls, or the peek-index for the first param
  // after 'value', i.e. meminstart.
  callType: function (opstr) {
    switch (opstr) {
      case 'CALL':
      case 'CALLCODE':
        // gas, addr, val, memin, meminsz, memout, memoutsz
        return 3; // stack ptr to memin

      case 'DELEGATECALL':
      case 'STATICCALL':
        // gas, addr, memin, meminsz, memout, memoutsz
        return 2; // stack ptr to memin
    }
    return false;
  },

  // store save the given indentifier and datasize.
  store: function (id, size) {
    var key = '' + toHex(id) + '-' + size;
    this.ids[key] = this.ids[key] + 1 || 1;
  },

  // step is invoked for every opcode that the VM executes.
  step: function (log, db) {
    // Skip any opcodes that are not internal calls
    var ct = this.callType(log.op.toString());
    if (!ct) {
      return;
    }
    // Skip any pre-compile invocations, those are just fancy opcodes
    if (isPrecompiled(toAddress(log.stack.peek(1).toString(16)))) {
      return;
    }
    // Gather internal call details
    var inSz = log.stack.peek(ct + 1).valueOf();
    if (inSz >= 4) {
      var inOff = log.stack.peek(ct).valueOf();
      this.store(log.memory.slice(inOff, inOff + 4), inSz - 4);
    }
  },

  // fault is invoked when the actual execution of an opcode fails.
  fault: function (log, db) {},

  // result is invoked when all the opcodes have been iterated over and returns
  // the final result of the tracing.
  result: function (ctx) {
    // Save the outer calldata also
    if (ctx.input.length >= 4) {
      this.store(slice(ctx.input, 0, 4), ctx.input.length - 4);
    }
    return this.ids;
  }
};`;

export const bigramTracer = `{
  // hist is the counters of opcode bigrams
  hist: {},
  // lastOp is last operation
  lastOp: '',
  // execution depth of last op
  lastDepth: 0,
  // step is invoked for every opcode that the VM executes.
  step: function (log, db) {
    var op = log.op.toString();
    var depth = log.getDepth();
    if (depth == this.lastDepth) {
      var key = this.lastOp + '-' + op;
      if (this.hist[key]) {
        this.hist[key]++;
      } else {
        this.hist[key] = 1;
      }
    }
    this.lastOp = op;
    this.lastDepth = depth;
  },
  // fault is invoked when the actual execution of an opcode fails.
  fault: function (log, db) {},
  // result is invoked when all the opcodes have been iterated over and returns
  // the final result of the tracing.
  result: function (ctx) {
    return this.hist;
  }
};`;

export const callTracer = `{
  // callstack is the current recursive call stack of the EVM execution.
  callstack: [{}],

  // descended tracks whether we've just descended from an outer transaction into
  // an inner call.
  descended: false,

  // step is invoked for every opcode that the VM executes.
  step: function (log, db) {
    // Capture any errors immediately
    var error = log.getError();
    if (error !== undefined) {
      this.fault(log, db);
      return;
    }
    // We only care about system opcodes, faster if we pre-check once
    var syscall = (log.op.toNumber() & 0xf0) == 0xf0;
    if (syscall) {
      var op = log.op.toString();
    }
    // If a new contract is being created, add to the call stack
    if (syscall && (op == 'CREATE' || op == 'CREATE2')) {
      var inOff = log.stack.peek(1).valueOf();
      var inEnd = inOff + log.stack.peek(2).valueOf();

      // Assemble the internal call report and store for completion
      var call = {
        type: op,
        from: toHex(log.contract.getAddress()),
        input: toHex(log.memory.slice(inOff, inEnd)),
        gasIn: log.getGas(),
        gasCost: log.getCost(),
        value: '0x' + log.stack.peek(0).toString(16)
      };
      this.callstack.push(call);
      this.descended = true;
      return;
    }
    // If a contract is being self destructed, gather that as a subcall too
    if (syscall && op == 'SELFDESTRUCT') {
      var left = this.callstack.length;
      if (this.callstack[left - 1].calls === undefined) {
        this.callstack[left - 1].calls = [];
      }
      this.callstack[left - 1].calls.push({
        type: op,
        from: toHex(log.contract.getAddress()),
        to: toHex(toAddress(log.stack.peek(0).toString(16))),
        gasIn: log.getGas(),
        gasCost: log.getCost(),
        value: '0x' + db.getBalance(log.contract.getAddress()).toString(16)
      });
      return;
    }
    // If a new method invocation is being done, add to the call stack
    if (syscall && (op == 'CALL' || op == 'CALLCODE' || op == 'DELEGATECALL' || op == 'STATICCALL')) {
      // Skip any pre-compile invocations, those are just fancy opcodes
      var to = toAddress(log.stack.peek(1).toString(16));
      if (isPrecompiled(to)) {
        return;
      }
      var off = op == 'DELEGATECALL' || op == 'STATICCALL' ? 0 : 1;

      var inOff = log.stack.peek(2 + off).valueOf();
      var inEnd = inOff + log.stack.peek(3 + off).valueOf();

      // Assemble the internal call report and store for completion
      var call = {
        type: op,
        from: toHex(log.contract.getAddress()),
        to: toHex(to),
        input: toHex(log.memory.slice(inOff, inEnd)),
        gasIn: log.getGas(),
        gasCost: log.getCost(),
        outOff: log.stack.peek(4 + off).valueOf(),
        outLen: log.stack.peek(5 + off).valueOf()
      };
      if (op != 'DELEGATECALL' && op != 'STATICCALL') {
        call.value = '0x' + log.stack.peek(2).toString(16);
      }
      this.callstack.push(call);
      this.descended = true;
      return;
    }
    // If we've just descended into an inner call, retrieve it's true allowance. We
    // need to extract if from within the call as there may be funky gas dynamics
    // with regard to requested and actually given gas (2300 stipend, 63/64 rule).
    if (this.descended) {
      if (log.getDepth() >= this.callstack.length) {
        this.callstack[this.callstack.length - 1].gas = log.getGas();
      } else {
        // TODO(karalabe): The call was made to a plain account. We currently don't
        // have access to the true gas amount inside the call and so any amount will
        // mostly be wrong since it depends on a lot of input args. Skip gas for now.
      }
      this.descended = false;
    }
    // If an existing call is returning, pop off the call stack
    if (syscall && op == 'REVERT') {
      this.callstack[this.callstack.length - 1].error = 'execution reverted';
      return;
    }
    if (log.getDepth() == this.callstack.length - 1) {
      // Pop off the last call and get the execution results
      var call = this.callstack.pop();

      if (call.type == 'CREATE' || call.type == 'CREATE2') {
        // If the call was a CREATE, retrieve the contract address and output code
        call.gasUsed = '0x' + bigInt(call.gasIn - call.gasCost - log.getGas()).toString(16);
        delete call.gasIn;
        delete call.gasCost;

        var ret = log.stack.peek(0);
        if (!ret.equals(0)) {
          call.to = toHex(toAddress(ret.toString(16)));
          call.output = toHex(db.getCode(toAddress(ret.toString(16))));
        } else if (call.error === undefined) {
          call.error = 'internal failure'; // TODO(karalabe): surface these faults somehow
        }
      } else {
        // If the call was a contract call, retrieve the gas usage and output
        if (call.gas !== undefined) {
          call.gasUsed = '0x' + bigInt(call.gasIn - call.gasCost + call.gas - log.getGas()).toString(16);
        }
        var ret = log.stack.peek(0);
        if (!ret.equals(0)) {
          call.output = toHex(log.memory.slice(call.outOff, call.outOff + call.outLen));
        } else if (call.error === undefined) {
          call.error = 'internal failure'; // TODO(karalabe): surface these faults somehow
        }
        delete call.gasIn;
        delete call.gasCost;
        delete call.outOff;
        delete call.outLen;
      }
      if (call.gas !== undefined) {
        call.gas = '0x' + bigInt(call.gas).toString(16);
      }
      // Inject the call into the previous one
      var left = this.callstack.length;
      if (this.callstack[left - 1].calls === undefined) {
        this.callstack[left - 1].calls = [];
      }
      this.callstack[left - 1].calls.push(call);
    }
  },

  // fault is invoked when the actual execution of an opcode fails.
  fault: function (log, db) {
    // If the topmost call already reverted, don't handle the additional fault again
    if (this.callstack[this.callstack.length - 1].error !== undefined) {
      return;
    }
    // Pop off the just failed call
    var call = this.callstack.pop();
    call.error = log.getError();

    // Consume all available gas and clean any leftovers
    if (call.gas !== undefined) {
      call.gas = '0x' + bigInt(call.gas).toString(16);
      call.gasUsed = call.gas;
    }
    delete call.gasIn;
    delete call.gasCost;
    delete call.outOff;
    delete call.outLen;

    // Flatten the failed call into its parent
    var left = this.callstack.length;
    if (left > 0) {
      if (this.callstack[left - 1].calls === undefined) {
        this.callstack[left - 1].calls = [];
      }
      this.callstack[left - 1].calls.push(call);
      return;
    }
    // Last call failed too, leave it in the stack
    this.callstack.push(call);
  },

  // result is invoked when all the opcodes have been iterated over and returns
  // the final result of the tracing.
  result: function (ctx, db) {
    var result = {
      type: ctx.type,
      from: toHex(ctx.from),
      to: toHex(ctx.to),
      value: '0x' + ctx.value.toString(16),
      gas: '0x' + bigInt(ctx.gas).toString(16),
      gasUsed: '0x' + bigInt(ctx.gasUsed).toString(16),
      input: toHex(ctx.input),
      output: toHex(ctx.output),
      time: ctx.time
    };
    if (this.callstack[0].calls !== undefined) {
      result.calls = this.callstack[0].calls;
    }
    if (this.callstack[0].error !== undefined) {
      result.error = this.callstack[0].error;
    } else if (ctx.error !== undefined) {
      result.error = ctx.error;
    }
    if (result.error !== undefined && (result.error !== 'execution reverted' || result.output === '0x')) {
      delete result.output;
    }
    return this.finalize(result);
  },

  // finalize recreates a call object using the final desired field oder for json
  // serialization. This is a nicety feature to pass meaningfully ordered results
  // to users who don't interpret it, just display it.
  finalize: function (call) {
    var sorted = {
      type: call.type,
      from: call.from,
      to: call.to,
      value: call.value,
      gas: call.gas,
      gasUsed: call.gasUsed,
      input: call.input,
      output: call.output,
      error: call.error,
      time: call.time,
      calls: call.calls
    };
    for (var key in sorted) {
      if (sorted[key] === undefined) {
        delete sorted[key];
      }
    }
    if (sorted.calls !== undefined) {
      for (var i = 0; i < sorted.calls.length; i++) {
        sorted.calls[i] = this.finalize(sorted.calls[i]);
      }
    }
    return sorted;
  }
};`;

export const evmdisTracer = `{
  stack: [{ ops: [] }],

  npushes: {
    0: 0,
    1: 1,
    2: 1,
    3: 1,
    4: 1,
    5: 1,
    6: 1,
    7: 1,
    8: 1,
    9: 1,
    10: 1,
    11: 1,
    16: 1,
    17: 1,
    18: 1,
    19: 1,
    20: 1,
    21: 1,
    22: 1,
    23: 1,
    24: 1,
    25: 1,
    26: 1,
    32: 1,
    48: 1,
    49: 1,
    50: 1,
    51: 1,
    52: 1,
    53: 1,
    54: 1,
    55: 0,
    56: 1,
    57: 0,
    58: 1,
    59: 1,
    60: 0,
    64: 1,
    65: 1,
    66: 1,
    67: 1,
    68: 1,
    69: 1,
    80: 0,
    81: 1,
    82: 0,
    83: 0,
    84: 1,
    85: 0,
    86: 0,
    87: 0,
    88: 1,
    89: 1,
    90: 1,
    91: 0,
    96: 1,
    97: 1,
    98: 1,
    99: 1,
    100: 1,
    101: 1,
    102: 1,
    103: 1,
    104: 1,
    105: 1,
    106: 1,
    107: 1,
    108: 1,
    109: 1,
    110: 1,
    111: 1,
    112: 1,
    113: 1,
    114: 1,
    115: 1,
    116: 1,
    117: 1,
    118: 1,
    119: 1,
    120: 1,
    121: 1,
    122: 1,
    123: 1,
    124: 1,
    125: 1,
    126: 1,
    127: 1,
    128: 2,
    129: 3,
    130: 4,
    131: 5,
    132: 6,
    133: 7,
    134: 8,
    135: 9,
    136: 10,
    137: 11,
    138: 12,
    139: 13,
    140: 14,
    141: 15,
    142: 16,
    143: 17,
    144: 2,
    145: 3,
    146: 4,
    147: 5,
    148: 6,
    149: 7,
    150: 8,
    151: 9,
    152: 10,
    153: 11,
    154: 12,
    155: 13,
    156: 14,
    157: 15,
    158: 16,
    159: 17,
    160: 0,
    161: 0,
    162: 0,
    163: 0,
    164: 0,
    240: 1,
    241: 1,
    242: 1,
    243: 0,
    244: 0,
    255: 0
  },

  // result is invoked when all the opcodes have been iterated over and returns
  // the final result of the tracing.
  result: function () {
    return this.stack[0].ops;
  },

  // fault is invoked when the actual execution of an opcode fails.
  fault: function (log, db) {},

  // step is invoked for every opcode that the VM executes.
  step: function (log, db) {
    var frame = this.stack[this.stack.length - 1];

    var error = log.getError();
    if (error) {
      frame['error'] = error;
    } else if (log.getDepth() == this.stack.length) {
      opinfo = {
        op: log.op.toNumber(),
        depth: log.getDepth(),
        result: []
      };
      if (frame.ops.length > 0) {
        var prevop = frame.ops[frame.ops.length - 1];
        for (var i = 0; i < this.npushes[prevop.op]; i++) prevop.result.push(log.stack.peek(i).toString(16));
      }
      switch (log.op.toString()) {
        case 'CALL':
        case 'CALLCODE':
          var instart = log.stack.peek(3).valueOf();
          var insize = log.stack.peek(4).valueOf();
          opinfo['gas'] = log.stack.peek(0).valueOf();
          opinfo['to'] = log.stack.peek(1).toString(16);
          opinfo['value'] = log.stack.peek(2).toString();
          opinfo['input'] = log.memory.slice(instart, instart + insize);
          opinfo['error'] = null;
          opinfo['return'] = null;
          opinfo['ops'] = [];
          this.stack.push(opinfo);
          break;
        case 'DELEGATECALL':
        case 'STATICCALL':
          var instart = log.stack.peek(2).valueOf();
          var insize = log.stack.peek(3).valueOf();
          opinfo['op'] = log.op.toString();
          opinfo['gas'] = log.stack.peek(0).valueOf();
          opinfo['to'] = log.stack.peek(1).toString(16);
          opinfo['input'] = log.memory.slice(instart, instart + insize);
          opinfo['error'] = null;
          opinfo['return'] = null;
          opinfo['ops'] = [];
          this.stack.push(opinfo);
          break;
        case 'RETURN':
          var out = log.stack.peek(0).valueOf();
          var outsize = log.stack.peek(1).valueOf();
          frame.return = log.memory.slice(out, out + outsize);
          break;
        case 'STOP':
        case 'SUICIDE':
          frame.return = log.memory.slice(0, 0);
          break;
        case 'JUMPDEST':
          opinfo['pc'] = log.getPC();
      }
      if (log.op.isPush()) {
        opinfo['len'] = log.op.toNumber() - 0x5e;
      }
      frame.ops.push(opinfo);
    } else {
      this.stack = this.stack.slice(0, log.getDepth());
    }
  }
};`;

export const noopTracer = `{
  // step is invoked for every opcode that the VM executes.
  step: function (log, db) {},

  // fault is invoked when the actual execution of an opcode fails.
  fault: function (log, db) {},

  // result is invoked when all the opcodes have been iterated over and returns
  // the final result of the tracing.
  result: function (ctx, db) {
    return {};
  }
};`;

export const opcountTracer = `{
  // count tracks the number of EVM instructions executed.
  count: 0,

  // step is invoked for every opcode that the VM executes.
  step: function (log, db) {
    this.count++;
  },

  // fault is invoked when the actual execution of an opcode fails.
  fault: function (log, db) {},

  // result is invoked when all the opcodes have been iterated over and returns
  // the final result of the tracing.
  result: function (ctx, db) {
    return this.count;
  }
};`;

export const prestateTracer = `{
  // prestate is the genesis that we're building.
  prestate: null,

  // lookupAccount injects the specified account into the prestate object.
  lookupAccount: function (addr, db) {
    var acc = toHex(addr);
    if (this.prestate[acc] === undefined) {
      this.prestate[acc] = {
        balance: '0x' + db.getBalance(addr).toString(16),
        nonce: db.getNonce(addr),
        code: toHex(db.getCode(addr)),
        storage: {}
      };
    }
  },

  // lookupStorage injects the specified storage entry of the given account into
  // the prestate object.
  lookupStorage: function (addr, key, db) {
    var acc = toHex(addr);
    var idx = toHex(key);

    if (this.prestate[acc].storage[idx] === undefined) {
      this.prestate[acc].storage[idx] = toHex(db.getState(addr, key));
    }
  },

  // result is invoked when all the opcodes have been iterated over and returns
  // the final result of the tracing.
  result: function (ctx, db) {
    // At this point, we need to deduct the 'value' from the
    // outer transaction, and move it back to the origin
    this.lookupAccount(ctx.from, db);

    var fromBal = bigInt(this.prestate[toHex(ctx.from)].balance.slice(2), 16);
    var toBal = bigInt(this.prestate[toHex(ctx.to)].balance.slice(2), 16);

    this.prestate[toHex(ctx.to)].balance = '0x' + toBal.subtract(ctx.value).toString(16);
    this.prestate[toHex(ctx.from)].balance =
      '0x' +
      fromBal
        .add(ctx.value)
        .add((ctx.gasUsed + ctx.intrinsicGas) * ctx.gasPrice)
        .toString(16);

    // Decrement the caller's nonce, and remove empty create targets
    this.prestate[toHex(ctx.from)].nonce--;
    if (ctx.type == 'CREATE') {
      // We can blibdly delete the contract prestate, as any existing state would
      // have caused the transaction to be rejected as invalid in the first place.
      delete this.prestate[toHex(ctx.to)];
    }
    // Return the assembled allocations (prestate)
    return this.prestate;
  },

  // step is invoked for every opcode that the VM executes.
  step: function (log, db) {
    // Add the current account if we just started tracing
    if (this.prestate === null) {
      this.prestate = {};
      // Balance will potentially be wrong here, since this will include the value
      // sent along with the message. We fix that in 'result()'.
      this.lookupAccount(log.contract.getAddress(), db);
    }
    // Whenever new state is accessed, add it to the prestate
    switch (log.op.toString()) {
      case 'EXTCODECOPY':
      case 'EXTCODESIZE':
      case 'BALANCE':
        this.lookupAccount(toAddress(log.stack.peek(0).toString(16)), db);
        break;
      case 'CREATE':
        var from = log.contract.getAddress();
        this.lookupAccount(toContract(from, db.getNonce(from)), db);
        break;
      case 'CREATE2':
        var from = log.contract.getAddress();
        // stack: salt, size, offset, endowment
        var offset = log.stack.peek(1).valueOf();
        var size = log.stack.peek(2).valueOf();
        var end = offset + size;
        this.lookupAccount(toContract2(from, log.stack.peek(3).toString(16), log.memory.slice(offset, end)), db);
        break;
      case 'CALL':
      case 'CALLCODE':
      case 'DELEGATECALL':
      case 'STATICCALL':
        this.lookupAccount(toAddress(log.stack.peek(1).toString(16)), db);
        break;
      case 'SSTORE':
      case 'SLOAD':
        this.lookupStorage(log.contract.getAddress(), toWord(log.stack.peek(0).toString(16)), db);
        break;
    }
  },

  // fault is invoked when the actual execution of an opcode fails.
  fault: function (log, db) {}
};`;

export const trigramTracer = `{
  // hist is the map of trigram counters
  hist: {},
  // lastOp is last operation
  lastOps: ['', ''],
  lastDepth: 0,
  // step is invoked for every opcode that the VM executes.
  step: function (log, db) {
    var depth = log.getDepth();
    if (depth != this.lastDepth) {
      this.lastOps = ['', ''];
      this.lastDepth = depth;
      return;
    }
    var op = log.op.toString();
    var key = this.lastOps[0] + '-' + this.lastOps[1] + '-' + op;
    if (this.hist[key]) {
      this.hist[key]++;
    } else {
      this.hist[key] = 1;
    }
    this.lastOps[0] = this.lastOps[1];
    this.lastOps[1] = op;
  },
  // fault is invoked when the actual execution of an opcode fails.
  fault: function (log, db) {},
  // result is invoked when all the opcodes have been iterated over and returns
  // the final result of the tracing.
  result: function (ctx) {
    return this.hist;
  }
};`;

export const unigramTracer = `{
  // hist is the map of opcodes to counters
  hist: {},
  // nops counts number of ops
  nops: 0,
  // step is invoked for every opcode that the VM executes.
  step: function (log, db) {
    var op = log.op.toString();
    if (this.hist[op]) {
      this.hist[op]++;
    } else {
      this.hist[op] = 1;
    }
    this.nops++;
  },
  // fault is invoked when the actual execution of an opcode fails.
  fault: function (log, db) {},

  // result is invoked when all the opcodes have been iterated over and returns
  // the final result of the tracing.
  result: function (ctx) {
    return this.hist;
  }
};`;

export const replayTracer = `
// tracer allows Geth's 'debug_traceTransaction' to mimic the output of Parity's 'trace_replayTransaction'
{
    // The call stack of the EVM execution.
    callStack: [{}],

    // step is invoked for every opcode that the VM executes.
    step(log, db) {
        // Capture any errors immediately
        var error = log.getError();

        if (error !== undefined) {
            this.fault(log, db);
        } else {
            this.success(log, db);
        }
    },

    // fault is invoked when the actual execution of an opcode fails.
    fault(log, db) {
        // If the topmost call already reverted, don't handle the additional fault again
        if (this.topCall().error === undefined) {
            this.putError(log);
        }
    },

    putError(log) {
        if (this.callStack.length > 1) {
            this.putErrorInTopCall(log);
        } else {
            this.putErrorInBottomCall(log);
        }
    },

    putErrorInTopCall(log) {
        // Pop off the just failed call
        var call = this.callStack.pop();
        this.putErrorInCall(log, call);
        this.pushChildCall(call);
    },

    putErrorInBottomCall(log) {
        var call = this.bottomCall();
        this.putErrorInCall(log, call);
    },

    putErrorInCall(log, call) {
        call.error = log.getError();

        // Consume all available gas and clean any leftovers
        if (call.gasBigInt !== undefined) {
            call.gasUsedBigInt = call.gasBigInt;
        }

        delete call.outputOffset;
        delete call.outputLength;
    },

    topCall() {
        return this.callStack[this.callStack.length - 1];
    },

    bottomCall() {
        return this.callStack[0];
    },

    pushChildCall(childCall) {
        var topCall = this.topCall();

        if (topCall.calls === undefined) {
            topCall.calls = [];
        }

        topCall.calls.push(childCall);
    },

    pushGasToTopCall(log) {
        var topCall = this.topCall();

        if (topCall.gasBigInt === undefined) {
            topCall.gasBigInt = log.getGas();
        }
        topCall.gasUsedBigInt = topCall.gasBigInt - log.getGas() - log.getCost();
    },

    success(log, db) {
        var op = log.op.toString();

        this.beforeOp(log, db);

        switch (op) {
            case 'CREATE':
                this.createOp(log);
                break;
            case 'CREATE2':
                this.create2Op(log);
                break;
            case 'SELFDESTRUCT':
                this.selfDestructOp(log, db);
                break;
            case 'CALL':
            case 'CALLCODE':
            case 'DELEGATECALL':
            case 'STATICCALL':
                this.callOp(log, op);
                break;
            case 'REVERT':
                this.revertOp();
                break;
        }
    },

    beforeOp(log, db) {
        /**
         * Depths
         * 0 - 'ctx'.  Never shows up in 'log.getDepth()'
         * 1 - first level of 'log.getDepth()'
         *
         * callStack indexes
         *
         * 0 - pseudo-call stand-in for 'ctx' in initializer ('callStack: [{}]')
         * 1 - first callOp inside of 'ctx'
         */
        var logDepth = log.getDepth();
        var callStackDepth = this.callStack.length;

        if (logDepth < callStackDepth) {
            // Pop off the last call and get the execution results
            var call = this.callStack.pop();

            var ret = log.stack.peek(0);

            if (!ret.equals(0)) {
                if (call.type === 'create' || call.type === 'create2') {
                    call.createdContractAddressHash = toHex(toAddress(ret.toString(16)));
                    call.createdContractCode = toHex(db.getCode(toAddress(ret.toString(16))));
                } else {
                    call.output = toHex(log.memory.slice(call.outputOffset, call.outputOffset + call.outputLength));
                }
            } else if (call.error === undefined) {
                call.error = 'internal failure';
            }

            delete call.outputOffset;
            delete call.outputLength;

            this.pushChildCall(call);
        }
        else {
            this.pushGasToTopCall(log);
        }
    },

    createOp(log) {
        var inputOffset = log.stack.peek(1).valueOf();
        var inputLength = log.stack.peek(2).valueOf();
        var inputEnd = inputOffset + inputLength;
        var stackValue = log.stack.peek(0);

        var call = {
            type: 'create',
            from: toHex(log.contract.getAddress()),
            init: toHex(log.memory.slice(inputOffset, inputEnd)),
            valueBigInt: bigInt(stackValue.toString(10))
        };
        this.callStack.push(call);
    },

    create2Op(log) {
        var inputOffset = log.stack.peek(1).valueOf();
        var inputLength = log.stack.peek(2).valueOf();
        var inputEnd = inputOffset + inputLength;
        var stackValue = log.stack.peek(0);

        var call = {
            type: 'create2',
            from: toHex(log.contract.getAddress()),
            init: toHex(log.memory.slice(inputOffset, inputEnd)),
            valueBigInt: bigInt(stackValue.toString(10))
        };
        this.callStack.push(call);
    },

    selfDestructOp(log, db) {
        var contractAddress = log.contract.getAddress();

        this.pushChildCall({
            type: 'selfdestruct',
            from: toHex(contractAddress),
            to: toHex(toAddress(log.stack.peek(0).toString(16))),
            gasBigInt: log.getGas(),
            gasUsedBigInt: log.getCost(),
            valueBigInt: db.getBalance(contractAddress)
        });
    },

    callOp(log, op) {
        var to = toAddress(log.stack.peek(1).toString(16));

        // Skip any pre-compile invocations, those are just fancy opcodes
        if (!isPrecompiled(to)) {
            this.callCustomOp(log, op, to);
        }
    },

    callCustomOp(log, op, to) {
        var stackOffset = (op === 'DELEGATECALL' || op === 'STATICCALL' ? 0 : 1);

        var inputOffset = log.stack.peek(2 + stackOffset).valueOf();
        var inputLength = log.stack.peek(3 + stackOffset).valueOf();
        var inputEnd = inputOffset + inputLength;

        var call = {
            type: 'call',
            callType: op.toLowerCase(),
            from: toHex(log.contract.getAddress()),
            to: toHex(to),
            input: toHex(log.memory.slice(inputOffset, inputEnd)),
            outputOffset: log.stack.peek(4 + stackOffset).valueOf(),
            outputLength: log.stack.peek(5 + stackOffset).valueOf()
        };

        switch (op) {
            case 'CALL':
            case 'CALLCODE':
                call.valueBigInt = bigInt(log.stack.peek(2));
                break;
            case 'DELEGATECALL':
                // value inherited from scope during call sequencing
                break;
            case 'STATICCALL':
                // by definition static calls transfer no value
                call.valueBigInt = bigInt.zero;
                break;
            default:
                throw 'Unknown custom call op ' + op;
        }

        this.callStack.push(call);
    },

    revertOp() {
        this.topCall().error = 'execution reverted';
    },

    // result is invoked when all the opcodes have been iterated over and returns
    // the final result of the tracing.
    result(ctx, db) {
        var result = this.ctxToResult(ctx, db);
        var filtered = this.filterNotUndefined(result);
        var callSequence = this.sequence(filtered, [], filtered.valueBigInt, []).callSequence;
        return this.encodeCallSequence(callSequence);
    },

    ctxToResult(ctx, db) {
        var result;

        switch (ctx.type) {
            case 'CALL':
                result = this.ctxToCall(ctx);
                break;
            case 'CREATE':
                result = this.ctxToCreate(ctx, db);
                break;
            case 'CREATE2':
                result = this.ctxToCreate2(ctx, db);
                break;
        }

        return result;
    },

    ctxToCall(ctx) {
        var result = {
            type: 'call',
            callType: 'call',
            from: toHex(ctx.from),
            to: toHex(ctx.to),
            valueBigInt: bigInt(ctx.value.toString(10)),
            gasBigInt: bigInt(ctx.gas),
            gasUsedBigInt: bigInt(ctx.gasUsed),
            input: toHex(ctx.input)
        };

        this.putBottomChildCalls(result);
        this.putErrorOrOutput(result, ctx);

        return result;
    },

    putErrorOrOutput(result, ctx) {
        var error = this.error(ctx);

        if (error !== undefined) {
            result.error = error;
        } else {
            result.output = toHex(ctx.output);
        }
    },

    ctxToCreate(ctx, db) {
        var result = {
            type: 'create',
            from: toHex(ctx.from),
            init: toHex(ctx.input),
            valueBigInt: bigInt(ctx.value.toString(10)),
            gasBigInt: bigInt(ctx.gas),
            gasUsedBigInt: bigInt(ctx.gasUsed)
        };

        this.putBottomChildCalls(result);
        this.putErrorOrCreatedContract(result, ctx, db);

        return result;
    },

    ctxToCreate2(ctx, db) {
        var result = {
            type: 'create2',
            from: toHex(ctx.from),
            init: toHex(ctx.input),
            valueBigInt: bigInt(ctx.value.toString(10)),
            gasBigInt: bigInt(ctx.gas),
            gasUsedBigInt: bigInt(ctx.gasUsed)
        };

        this.putBottomChildCalls(result);
        this.putErrorOrCreatedContract(result, ctx, db);

        return result;
    },

    putBottomChildCalls(result) {
        var bottomCall = this.bottomCall();
        var bottomChildCalls = bottomCall.calls;

        if (bottomChildCalls !== undefined) {
            result.calls = bottomChildCalls;
        }
    },

    putErrorOrCreatedContract(result, ctx, db) {
        var error = this.error(ctx);

        if (error !== undefined) {
            result.error = error
        } else {
            result.createdContractAddressHash = toHex(ctx.to);
            if (toHex(ctx.input) != '0x') {
              result.createdContractCode = toHex(db.getCode(ctx.to));
            } else {
              result.createdContractCode = '0x';
            }
        }
    },

    error(ctx) {
        var error;

        var bottomCall = this.bottomCall();
        var bottomCallError = bottomCall.error;

        if (bottomCallError !== undefined) {
            error = bottomCallError;
        } else {
            var ctxError = ctx.error;

            if (ctxError !== undefined) {
                error = ctxError;
            }
        }

        return error;
    },

    filterNotUndefined(call) {
        for (var key in call) {
            if (call[key] === undefined) {
                delete call[key];
            }
        }

        if (call.calls !== undefined) {
            for (var i = 0; i < call.calls.length; i++) {
                call.calls[i] = this.filterNotUndefined(call.calls[i]);
            }
        }

        return call;
    },

    // sequence converts the finalized calls from a call tree to a call sequence
    sequence(call, callSequence, availableValueBigInt, traceAddress) {
        var subcalls = call.calls;
        delete call.calls;

        call.traceAddress = traceAddress;

        if (call.type === 'call' && call.callType === 'delegatecall') {
            call.valueBigInt = availableValueBigInt;
        }

        var newCallSequence = callSequence.concat([call]);

        if (subcalls !== undefined) {
            for (var i = 0; i < subcalls.length; i++) {
                var nestedSequenced = this.sequence(
                    subcalls[i],
                    newCallSequence,
                    call.valueBigInt,
                    traceAddress.concat([i])
                );
                newCallSequence = nestedSequenced.callSequence;
            }
        }

        return {
            callSequence: newCallSequence
        };
    },

    encodeCallSequence(calls) {
        for (var i = 0; i < calls.length; i++) {
            this.encodeCall(calls[i]);
        }

        return calls;
    },

    encodeCall(call) {
        this.putValue(call);
        this.putGas(call);
        this.putGasUsed(call);

        return call;
    },

    putValue(call) {
        var valueBigInt = call.valueBigInt;
        delete call.valueBigInt;

        call.value = '0x' + valueBigInt.toString(16);
    },

    putGas(call) {
        var gasBigInt = call.gasBigInt;
        delete call.gasBigInt;

        if (gasBigInt === undefined) {
            gasBigInt = bigInt.zero;
        }

        call.gas = '0x' + gasBigInt.toString(16);
    },

    putGasUsed(call) {
        var gasUsedBigInt = call.gasUsedBigInt;
        delete call.gasUsedBigInt;

        if (gasUsedBigInt === undefined) {
            gasUsedBigInt = bigInt.zero;
        }

        call.gasUsed = '0x' + gasUsedBigInt.toString(16);
    }
}`;

export const tracers = new Map<string, string>([
  ['4byteTracer', fourByteTracer],
  ['bigramTracer', bigramTracer],
  ['callTracer', callTracer],
  ['evmdisTracer', evmdisTracer],
  ['noopTracer', noopTracer],
  ['opcountTracer', opcountTracer],
  ['prestateTracer', prestateTracer],
  ['trigramTracer', trigramTracer],
  ['unigramTracer', unigramTracer],
  ['replayTracer', replayTracer]
]);
