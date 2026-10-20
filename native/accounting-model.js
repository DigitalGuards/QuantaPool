'use strict';

const assert = require('node:assert/strict');

const UINT256_MAX = (1n << 256n) - 1n;
const SHARE_SCALE = 10n ** 27n;
const BASIS_SCALE = 10n ** 54n;
const FIXTURE = Symbol('independently verified economic fixture');
const min = (a, b) => (a < b ? a : b);

function uint(value, label = 'amount') {
  assert.equal(typeof value, 'bigint', `${label} must be bigint`);
  assert(value >= 0n && value <= UINT256_MAX, `${label} outside uint256`);
  return value;
}

function mulDiv(x, y, denominator, roundUp = false) {
  uint(x);
  uint(y);
  uint(denominator);
  assert(denominator > 0n, 'zero denominator');
  const product = x * y;
  return uint((product + (roundUp ? denominator - 1n : 0n)) / denominator);
}

/**
 * Independent economic specification. All fixture* methods describe a synthetic
 * chain whose checkpoint economics have ALREADY been independently verified.
 * The fixture marker is a test convention, never authentication or an oracle.
 * No production caller may report the cash, reward or loss values accepted here.
 *
 * Unreserved consensus earnings and principal share every loss. A user's basis
 * is remaining contributed principal. Fees become earned only when verified
 * net gains are reserved in cash for an exit or a native reward claim. Exempt
 * gifts and top-ups share asset risk and add fee basis through an accumulator.
 * Fee basis creates no asset entitlement. Its rounding may only reduce fees.
 *
 * Histories, fixture construction, and audit() may enumerate reference data.
 * Contract settlement must use bounded proofs, flow history lookup and queues;
 * it must never enumerate users or accept a snapshot importer.
 */
class NativeAccountingModel {
  constructor({ minDeposit = 1n, feeRecipient = 'operator' } = {}) {
    this.minDeposit = uint(minDeposit);
    assert(this.minDeposit > 0n && feeRecipient, 'invalid configuration');
    this.feeRecipient = feeRecipient;
    this.block = 1n;
    this.cash = 0n;
    this.validatorAssets = 0n;
    this.inFlight = 0n;
    this.riskAssets = 0n;
    this.totalShares = 0n;
    this.pendingTotal = 0n;
    this.claimReserve = 0n;
    this.feeReserve = 0n;
    this.orphanCash = 0n;
    this.accFeeBasis = 0n;
    this.deposited = 0n;
    this.paid = 0n;
    this.feesPaid = 0n;
    this.consensusDelta = 0n;
    this.exemptReceived = 0n;
    this.settledConsensus = 0n;
    this.settledExempt = 0n;
    this.eligibleConsensusRewardBudget = 0n;
    this.consensusLossCarry = 0n;
    this.lastCheckpoint = 0n;
    this.stage = null;
    this.fixtureAuthorityStatus = 0;
    this.fixtureStagingFresh = true;
    this.fixtureAllValidatorsTerminal = true;
    this.recovering = false;
    this.frozenShares = 0n;
    this.recoveryPaid = 0n;
    this.recoveryCash = 0n;
    this.users = new Map();
    this.pending = [];
    this.pendingHead = 0;
    this.requests = [];
    this.queueHead = 0;
    this.flows = [{ block: 0n, deposited: 0n, paid: 0n }];
  }

  advance(block = this.block + 1n) {
    assert(uint(block) > this.block, 'block must advance');
    this.block = block;
  }

  user(id) {
    assert(typeof id === 'string' && id.length > 0, 'invalid beneficiary');
    if (!this.users.has(id))
      this.users.set(id, {
        shares: 0n,
        basis: 0n,
        pending: 0n,
        principalClaim: 0n,
        rewardClaim: 0n,
        feeRemainder: 0n,
        feeBasis: 0n,
        feeBasisIndex: this.accFeeBasis,
        feeBasisFraction: 0n,
        recoveryClaimed: 0n,
        paid: 0n,
        activeRequest: false,
        activeRequestIndex: -1,
      });
    return this.users.get(id);
  }

  _open() {
    assert(
      !this.recovering && !this.stage && this.fixtureAuthorityStatus === 0,
      'normal actions unavailable'
    );
  }

  _flow() {
    const value = { block: this.block, deposited: this.deposited, paid: this.paid };
    if (this.flows.at(-1).block === this.block) this.flows[this.flows.length - 1] = value;
    else this.flows.push(value);
  }

  _flowAt(block) {
    let low = 0,
      high = this.flows.length;
    while (low + 1 < high) {
      const middle = (low + high) >> 1;
      if (this.flows[middle].block <= block) low = middle;
      else high = middle;
    }
    return this.flows[low];
  }

  _touch(user) {
    const oldCeiling = user.feeBasisFraction > 0n ? 1n : 0n;
    const scaled = user.shares * (this.accFeeBasis - user.feeBasisIndex) + user.feeBasisFraction;
    user.feeBasisFraction = scaled % BASIS_SCALE;
    user.feeBasis += scaled / BASIS_SCALE + (user.feeBasisFraction > 0n ? 1n : 0n) - oldCeiling;
    user.feeBasisIndex = this.accFeeBasis;
  }

  _pay(user, amount) {
    uint(amount);
    assert(amount <= this.cash, 'insufficient cash');
    this.cash -= amount;
    this.paid = uint(this.paid + amount);
    user.paid += amount;
    this._flow();
  }

  deposit(id, amount) {
    this._open();
    uint(amount);
    assert(amount >= this.minDeposit, 'minimum deposit');
    uint(this.deposited + amount);
    uint(this.cash + amount);
    const user = this.user(id);
    user.pending += amount;
    this.pendingTotal += amount;
    this.cash += amount;
    this.deposited += amount;
    this.pending.push({ id, amount, block: this.block, cancelled: false });
    this._flow();
    return this.pending.length - 1;
  }

  cancelPending(id, index) {
    assert(!this.stage || this.recovering, 'checkpoint staging');
    const item = this.pending[index];
    assert(
      item && item.id === id && !item.cancelled && index >= this.pendingHead,
      'not an owned pending deposit'
    );
    const user = this.user(id);
    item.cancelled = true;
    user.pending -= item.amount;
    this.pendingTotal -= item.amount;
    this._pay(user, item.amount);
  }

  requestWithdrawal(id, amount = null) {
    return this._request(id, 'withdrawal', amount);
  }
  requestRewards(id, amount = null) {
    return this._request(id, 'rewards', amount);
  }

  _request(id, kind, amount) {
    this._open();
    const user = this.user(id);
    assert(user.shares > 0n && !user.activeRequest, 'no available position');
    if (amount !== null) assert(uint(amount) > 0n, 'zero requested amount');
    user.activeRequest = true;
    user.activeRequestIndex = this.requests.length;
    this.requests.push({ id, kind, amount, block: this.block });
    return this.requests.length - 1;
  }

  cancelRequest(id) {
    assert(!this.stage && !this.recovering, 'checkpoint staging or recovery');
    const user = this.user(id);
    assert(user.activeRequest, 'no active request');
    const request = this.requests[user.activeRequestIndex];
    assert(request && request.id === id && !request.cancelled, 'missing active request');
    request.cancelled = true;
    user.activeRequest = false;
    user.activeRequestIndex = -1;
  }

  // Atomically adopted preparation capital was excluded from earlier pool
  // checkpoints. The verified fixture adds its physical validator assets once.
  fixtureAdmitCapital(id, amount) {
    this._open();
    uint(amount);
    assert(
      amount > 0n && this.lastCheckpoint > 0n && this.fixtureStagingFresh,
      'invalid adopted capital'
    );
    assert(this.totalShares === 0n || this.riskAssets > 0n, 'lost cohort cannot admit capital');
    const units =
      this.totalShares === 0n
        ? uint(amount * SHARE_SCALE)
        : mulDiv(amount, this.totalShares, this.riskAssets);
    assert(units > 0n, 'capital precision');
    uint(this.totalShares + units);
    const user = this.user(id);
    this._touch(user);
    user.shares += units;
    user.basis += amount;
    user.feeBasis += amount;
    user.feeBasisFraction = 0n;
    this.totalShares += units;
    this.riskAssets += amount;
    this.validatorAssets += amount;
    this.deposited = uint(this.deposited + amount);
    this._flow();
  }

  // Synthetic physical ledger operations, never pool-authorized balance setters.
  fixtureFund(amount) {
    this._open();
    uint(amount);
    assert(this.queueHead === this.requests.length, 'withdrawal queue takes priority');
    assert(amount <= this.freeCash(), 'reserved cash cannot fund validators');
    this.cash -= amount;
    this.inFlight += amount;
  }

  fixtureConsumeFunding(amount) {
    uint(amount);
    assert(amount <= this.inFlight, 'missing in-flight funding');
    this.inFlight -= amount;
    this.validatorAssets += amount;
  }

  fixtureConsensus(delta, { liquid = false } = {}) {
    assert(typeof delta === 'bigint', 'signed consensus delta required');
    const field = liquid ? 'cash' : 'validatorAssets';
    uint(this[field] + delta, 'physical fixture assets');
    this[field] += delta;
    this.consensusDelta += delta;
  }

  fixtureReturnPrincipal(amount) {
    uint(amount);
    assert(amount <= this.validatorAssets, 'invalid fixture return');
    this.validatorAssets -= amount;
    this.cash += amount;
  }

  fixtureExempt(amount, { liquid = true } = {}) {
    uint(amount);
    const field = liquid ? 'cash' : 'validatorAssets';
    this[field] = uint(this[field] + amount);
    this.exemptReceived += amount;
  }

  fixtureCheckpoint() {
    return Object.freeze({
      [FIXTURE]: true,
      block: this.block,
      cash: this.cash,
      validatorAssets: this.validatorAssets,
      inFlight: this.inFlight,
      consensusDelta: this.consensusDelta,
      exemptReceived: this.exemptReceived,
    });
  }

  freeCash() {
    return this.cash - this.pendingTotal - this.claimReserve - this.feeReserve - this.orphanCash;
  }

  settleCheckpoint(fixture) {
    this._open();
    assert(fixture[FIXTURE] === true, 'verified fixture input required');
    assert(
      fixture.block > this.lastCheckpoint && fixture.block < this.block,
      'cutoff must be finalized, increasing and earlier than execution'
    );
    const flow = this._flowAt(fixture.block);
    const gross =
      fixture.cash +
      fixture.validatorAssets +
      fixture.inFlight +
      (this.deposited - flow.deposited) -
      (this.paid - flow.paid);
    const consensus = fixture.consensusDelta - this.settledConsensus;
    const exempt = fixture.exemptReceived - this.settledExempt;
    assert(exempt >= 0n, 'exempt history regressed');
    let risk = this.riskAssets + consensus + exempt;
    uint(risk, 'settled risk assets');
    assert.equal(
      gross,
      risk + this.pendingTotal + this.claimReserve + this.feeReserve + this.orphanCash,
      'matched assets and flow history do not reconcile'
    );
    assert(
      this.cash >= this.pendingTotal + this.claimReserve + this.feeReserve,
      'cash-backed reserves unavailable'
    );
    if (consensus >= 0n) {
      const recovered = min(consensus, this.consensusLossCarry);
      this.consensusLossCarry -= recovered;
      this.eligibleConsensusRewardBudget += consensus - recovered;
    } else {
      const consumed = min(-consensus, this.eligibleConsensusRewardBudget);
      this.eligibleConsensusRewardBudget -= consumed;
      this.consensusLossCarry += -consensus - consumed;
    }
    if (this.totalShares === 0n) {
      assert(
        this.cash >=
          this.pendingTotal + this.claimReserve + this.feeReserve + this.orphanCash + risk,
        'ownerless assets are not available cash'
      );
      this.orphanCash += risk;
      risk = 0n;
      this.eligibleConsensusRewardBudget = 0n;
      this.consensusLossCarry = 0n;
    }
    this.riskAssets = risk;
    if (this.totalShares !== 0n)
      this.accFeeBasis = uint(
        this.accFeeBasis + mulDiv(exempt, BASIS_SCALE, this.totalShares, true),
        'fee-basis accumulator'
      );
    this.settledConsensus = fixture.consensusDelta;
    this.settledExempt = fixture.exemptReceived;
    this.lastCheckpoint = fixture.block;
    this.stage = {
      phase: 'deposits',
      cutoff: fixture.block,
      pendingEnd: this.pending.length,
      queueEnd: this.requests.length,
    };
  }

  activateDeposits(limit = 16) {
    assert(this.stage?.phase === 'deposits', 'not admitting deposits');
    assert(
      this.fixtureAuthorityStatus === 0 && this.fixtureStagingFresh,
      'staged checkpoint stale'
    );
    assert(Number.isSafeInteger(limit) && limit > 0, 'invalid batch bound');
    let processed = 0;
    while (processed < limit && this.pendingHead < this.stage.pendingEnd) {
      const item = this.pending[this.pendingHead];
      if (item.block >= this.stage.cutoff) break;
      if (!item.cancelled) {
        // A zero-valued existing cohort cannot sell its later-return rights.
        if (this.totalShares > 0n && this.riskAssets === 0n) break;
        const units =
          this.totalShares === 0n
            ? item.amount * SHARE_SCALE
            : (item.amount * this.totalShares) / this.riskAssets;
        if (units === 0n || units > UINT256_MAX - this.totalShares) break;
        const user = this.user(item.id);
        this._touch(user);
        user.shares += units;
        user.basis += item.amount;
        user.feeBasis += item.amount;
        // Keep the already-ceiled fee basis when membership changes. Forgiving
        // this fractional basis dust cannot transfer assets or overcharge fees.
        user.feeBasisFraction = 0n;
        user.pending -= item.amount;
        this.totalShares += units;
        this.riskAssets += item.amount;
        this.pendingTotal -= item.amount;
      }
      this.pendingHead++;
      processed++;
    }
    if (processed < limit || this.pendingHead === this.stage.pendingEnd) this.stage.phase = 'queue';
    return processed;
  }

  position(id) {
    const user = this.user(id);
    const value =
      this.totalShares === 0n ? 0n : mulDiv(user.shares, this.riskAssets, this.totalShares);
    const scaled = user.shares * (this.accFeeBasis - user.feeBasisIndex) + user.feeBasisFraction;
    const feeBasis =
      user.feeBasis +
      scaled / BASIS_SCALE +
      (scaled % BASIS_SCALE > 0n ? 1n : 0n) -
      (user.feeBasisFraction > 0n ? 1n : 0n);
    return {
      value,
      principal: min(value, user.basis),
      rewards: value > user.basis ? value - user.basis : 0n,
      loss: user.basis > value ? user.basis - value : 0n,
      shares: user.shares,
      feeBasis,
      pending: user.pending,
      claimable: user.principalClaim + user.rewardClaim,
    };
  }

  processQueue(limit = 16) {
    assert(this.stage?.phase === 'queue', 'not processing withdrawal queue');
    assert(
      this.fixtureAuthorityStatus === 0 && this.fixtureStagingFresh,
      'staged checkpoint stale'
    );
    assert(Number.isSafeInteger(limit) && limit > 0, 'invalid batch bound');
    let processed = 0;
    while (processed < limit && this.queueHead < this.stage.queueEnd) {
      const request = this.requests[this.queueHead];
      if (request.block >= this.stage.cutoff) break;
      if (request.cancelled) {
        this.queueHead++;
        processed++;
        continue;
      }
      const user = this.user(request.id);
      const view = this.position(request.id);
      if (view.value === 0n && !this.fixtureAllValidatorsTerminal) {
        user.activeRequest = false;
        user.activeRequestIndex = -1;
        this.queueHead++;
        processed++;
        continue;
      }
      let gross = request.kind === 'rewards' ? view.rewards : view.value;
      if (request.amount !== null) gross = min(gross, request.amount);
      let units = gross === 0n ? 0n : mulDiv(gross, this.totalShares, this.riskAssets, true);
      let basis = 0n;
      if (request.kind === 'withdrawal') {
        if (units >= user.shares || request.amount === null || view.value === 0n) {
          units = user.shares;
          gross = view.value;
          basis = user.basis;
        } else basis = mulDiv(user.basis, units, user.shares);
      } else if (user.basis > 0n && units >= user.shares) break;
      if (gross > this.freeCash()) break; // Strict global FIFO, no bypass.
      if (
        units !== 0n &&
        (units === this.totalShares || gross === 0n) &&
        !this.fixtureAllValidatorsTerminal
      )
        break;
      this._touch(user);
      const contributedGain = gross > basis ? gross - basis : 0n;
      let feeBasisUsed, taxable;
      if (request.kind === 'rewards') {
        taxable = min(
          min(gross, view.value > user.feeBasis ? view.value - user.feeBasis : 0n),
          this.eligibleConsensusRewardBudget
        );
        feeBasisUsed = gross - taxable;
      } else {
        feeBasisUsed =
          units === user.shares ? user.feeBasis : mulDiv(user.feeBasis, units, user.shares, true);
        taxable = min(
          min(contributedGain, gross > feeBasisUsed ? gross - feeBasisUsed : 0n),
          this.eligibleConsensusRewardBudget
        );
      }
      this.eligibleConsensusRewardBudget -= taxable;
      const numerator = taxable + user.feeRemainder;
      const fee = numerator / 10n;
      user.feeRemainder = numerator % 10n;
      assert(fee <= gross, 'fee exceeds realized payout');
      user.shares -= units;
      user.basis -= basis;
      user.feeBasis -= min(user.feeBasis, feeBasisUsed);
      if (user.feeBasis < user.basis) user.feeBasis = user.basis;
      user.feeBasisFraction = 0n;
      this.totalShares -= units;
      this.riskAssets -= gross;
      if (this.totalShares === 0n) {
        this.eligibleConsensusRewardBudget = 0n;
        this.consensusLossCarry = 0n;
      }
      user.principalClaim += min(gross, basis);
      user.rewardClaim += contributedGain - fee;
      this.claimReserve += gross - fee;
      this.feeReserve += fee;
      user.activeRequest = false;
      user.activeRequestIndex = -1;
      this.queueHead++;
      processed++;
    }
    if (processed < limit || this.queueHead === this.stage.queueEnd) this.stage = null;
    return processed;
  }

  abortStaging() {
    assert(
      this.stage && (this.fixtureAuthorityStatus !== 0 || !this.fixtureStagingFresh),
      'staging remains fresh'
    );
    this.stage = null;
  }

  claim(id, amount = null) {
    const user = this.user(id);
    const available = user.principalClaim + user.rewardClaim;
    const payment = amount === null ? available : uint(amount);
    assert(payment > 0n && payment <= available, 'no reserved claim');
    const principal = min(payment, user.principalClaim);
    user.principalClaim -= principal;
    user.rewardClaim -= payment - principal;
    this.claimReserve -= payment;
    this._pay(user, payment);
    return payment;
  }

  claimFee(id) {
    assert(id === this.feeRecipient && this.feeReserve > 0n, 'no earned operator fee');
    const amount = this.feeReserve;
    this.feeReserve = 0n;
    this.feesPaid += amount;
    this._pay(this.user(id), amount);
    return amount;
  }

  beginRecovery({ verifiedFixtureExpired = false } = {}) {
    assert(verifiedFixtureExpired && !this.recovering, 'verifier must be permanently expired');
    this.recovering = true;
    this.stage = null;
    this.frozenShares = this.totalShares;
    this.recoveryCash = this.freeCash();
    assert(this.recoveryCash >= 0n, 'recovery reserves underbacked');
  }

  claimRecovery(id) {
    assert(this.recovering && this.frozenShares > 0n, 'no recovery cohort');
    const user = this.user(id);
    const cumulative = this.freeCash() + this.recoveryPaid;
    assert(cumulative >= this.recoveryCash, 'recovery cash regressed');
    this.recoveryCash = cumulative;
    const entitlement = mulDiv(cumulative, user.shares, this.frozenShares);
    const amount = entitlement - user.recoveryClaimed;
    assert(amount > 0n, 'no recovered cash');
    user.recoveryClaimed = entitlement;
    this.recoveryPaid += amount;
    this._pay(user, amount);
    return amount;
  }

  audit() {
    let shares = 0n,
      pending = 0n,
      claims = 0n,
      recoveryClaims = 0n;
    for (const [id, user] of this.users) {
      for (const value of Object.values(user)) if (typeof value === 'bigint') uint(value);
      shares += user.shares;
      pending += user.pending;
      claims += user.principalClaim + user.rewardClaim;
      if (this.recovering && this.frozenShares > 0n)
        recoveryClaims +=
          mulDiv(this.freeCash() + this.recoveryPaid, user.shares, this.frozenShares) -
          user.recoveryClaimed;
      assert(
        user.feeRemainder < 10n && user.feeBasisFraction < BASIS_SCALE,
        `invalid carry for ${id}`
      );
      assert(user.feeBasis >= user.basis, 'fee basis cannot fall below contributed basis');
    }
    assert.equal(shares, this.totalShares);
    assert.equal(pending, this.pendingTotal);
    assert.equal(claims, this.claimReserve);
    uint(this.eligibleConsensusRewardBudget);
    uint(this.consensusLossCarry);
    assert(this.freeCash() >= 0n, 'cash reserves exceed physical cash');
    const physical = this.cash + this.validatorAssets + this.inFlight;
    assert.equal(
      physical + this.paid,
      this.deposited + this.consensusDelta + this.exemptReceived,
      'physical assets and external flows do not conserve'
    );
    if (this.recovering) assert(recoveryClaims <= this.freeCash(), 'recovery overclaim');
    else {
      const unobserved =
        this.consensusDelta - this.settledConsensus + this.exemptReceived - this.settledExempt;
      assert.equal(
        physical,
        this.riskAssets +
          this.pendingTotal +
          this.claimReserve +
          this.feeReserve +
          this.orphanCash +
          unobserved,
        'economic accounting does not conserve'
      );
    }
    return { physical, paid: this.paid, shares, claims, recoveryClaims };
  }
}

module.exports = { NativeAccountingModel, mulDiv, UINT256_MAX, SHARE_SCALE, BASIS_SCALE };
