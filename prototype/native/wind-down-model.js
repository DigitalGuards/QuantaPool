'use strict';

const assert = require('node:assert/strict');

const UINT256_MAX = (1n << 256n) - 1n;

function amount(value, label) {
  assert.equal(typeof value, 'bigint', `${label} must be bigint`);
  assert(value >= 0n && value <= UINT256_MAX, `${label} outside uint256`);
  return value;
}

function identity(value) {
  assert(typeof value === 'string' && value.length > 0, 'Missing immutable beneficiary');
  return value;
}

const min = (left, right) => left < right ? left : right;

/**
 * Executable arithmetic reference, without deployment or normal staking logic.
 *
 * The constructor imports a fixture representing EXISTING on-chain accounting.
 * Its O(n) snapshot import and audit() are test utilities. Production cutover
 * must use already-maintained totals and mappings, with no reporter/import API.
 * An imported snapshot's historical correctness is outside this model's proof.
 *
 * Pending deposits and cash-backed claims are senior segregated reserves.
 * Unfunded queued withdrawals retain internal stake shares. Active and queued
 * shares freeze together permanently; claims never burn their late-return rights.
 *
 * G = initial unreserved native cash + actual subsequent native credits.
 * entitlement(user) = floor(G * frozenUserShares / frozenTotalShares).
 * claimable(user) = entitlement(user) - alreadyPaid(user).
 * The fixed denominator allows an exact cumulative accumulator with no scale
 * truncation, using full-width mulDiv in an eventual uint256 implementation.
 * Native receipt, transition and individual claims perform O(1) accounting.
 *
 * Wind-down earns ZERO new operator fees. Only previously earned, fully
 * cash-reserved fees survive. No balance reporter, restart, sweep, beneficiary
 * update, share transfer, arbitrary withdrawal or entitlement setter exists.
 * Per-holder floors leave bounded dust; its fractional rights remain available
 * for future credits. A claimed position is never treated as permanently closed.
 */
class WindDownModel {
  #users = new Map();
  #cash;
  #initialCash;
  #received = 0n;
  #initialFreeCash;
  #totalShares = 0n;
  #initialReserves = 0n;
  #reservedPaid = 0n;
  #frozenPaid = 0n;
  #feeReserve;
  #feesPaid = 0n;
  #feeRecipient;
  #operatorFeesPaidBefore;
  #expirySlot;
  #active = false;
  #trigger = null;

  constructor({
    users,
    cash,
    feeRecipient,
    operatorFeeReserve = 0n,
    operatorFeesPaidBefore = 0n,
    lastVerifiedSlot,
    maxStaleSlots,
  }) {
    assert(Array.isArray(users), 'Snapshot users must be an array');
    this.#cash = this.#initialCash = amount(cash, 'cash');
    this.#feeRecipient = identity(feeRecipient);
    this.#feeReserve = amount(operatorFeeReserve, 'earned fee reserve');
    this.#operatorFeesPaidBefore = amount(operatorFeesPaidBefore, 'prior operator fees');
    this.#expirySlot = amount(
      amount(lastVerifiedSlot, 'last verified slot') + amount(maxStaleSlots, 'maximum staleness'),
      'expiry slot',
    );
    for (const input of users) {
      const beneficiary = identity(input.beneficiary);
      assert(!this.#users.has(beneficiary), 'Duplicate beneficiary');
      const position = { beneficiary };
      for (const field of [
        'activeShares', 'queuedShares', 'pendingDeposit', 'cashPrincipal', 'cashRewards',
        'principalBasis', 'feeAssessedRewardCarry', 'principalPaidBefore', 'rewardsPaidBefore',
      ]) position[field] = amount(input[field] ?? 0n, field);
      position.frozenShares = amount(position.activeShares + position.queuedShares, 'holder shares');
      position.reservedCash = amount(position.pendingDeposit + position.cashPrincipal + position.cashRewards, 'holder reserves');
      if (position.frozenShares === 0n) {
        assert.equal(position.principalBasis + position.feeAssessedRewardCarry, 0n, 'Unreserved basis requires residual shares');
      }
      this.#totalShares = amount(this.#totalShares + position.frozenShares, 'total shares');
      this.#initialReserves = amount(this.#initialReserves + position.reservedCash, 'total reserves');
      this.#users.set(beneficiary, { position: Object.freeze(position), reservedPaid: 0n, frozenPaid: 0n });
    }
    assert(this.#cash >= this.#initialReserves + this.#feeReserve, 'Every senior claim and earned fee must be cash backed');
    this.#initialFreeCash = this.#cash - this.#initialReserves - this.#feeReserve;
  }

  #user(beneficiary) {
    const user = this.#users.get(beneficiary);
    assert(user, 'Unknown beneficiary');
    return user;
  }

  get active() { return this.#active; }
  get cash() { return this.#cash; }
  get expirySlot() { return this.#expirySlot; }
  get totalShares() { return this.#totalShares; }
  get cumulativeGrossCash() { return this.#initialFreeCash + this.#received; }

  triggerWindDown(caller, currentSlot) {
    identity(caller);
    amount(currentSlot, 'current chain slot');
    if (this.#active) return false;
    assert(currentSlot > this.#expirySlot, 'Verifier has not expired');
    this.#active = true;
    this.#trigger = Object.freeze({ caller, slot: currentSlot });
    return true;
  }

  // This models actual native value entering the receiver, including direct
  // consensus balance credits. It is not an economic balance-reporting API.
  receiveNative(value) {
    amount(value, 'native credit');
    amount(this.#cash + value, 'native balance');
    amount(this.cumulativeGrossCash + value, 'cumulative native returns');
    this.#cash += value;
    this.#received += value;
  }

  position(beneficiary) {
    const user = this.#user(beneficiary);
    const allocation = this.#active && this.#totalShares > 0n
      ? this.cumulativeGrossCash * user.position.frozenShares / this.#totalShares : 0n;
    return Object.freeze({
      ...user.position,
      reservedPaid: user.reservedPaid,
      reservedRemaining: user.position.reservedCash - user.reservedPaid,
      cumulativeAllocation: allocation,
      frozenPaid: user.frozenPaid,
      frozenClaimable: allocation - user.frozenPaid,
      // Display-only historical basis. A missing return remains uncertain and
      // can recover later; expiry supplies no authenticated realized-loss value.
      principalCoveredByCash: min(allocation, user.position.principalBasis),
      principalNotYetCovered: user.position.principalBasis - min(allocation, user.position.principalBasis),
    });
  }

  claimReserved(caller, beneficiary, limit = UINT256_MAX) {
    identity(caller);
    amount(limit, 'claim limit');
    const user = this.#user(beneficiary);
    const paid = min(user.position.reservedCash - user.reservedPaid, limit);
    user.reservedPaid += paid;
    this.#reservedPaid += paid;
    this.#cash -= paid;
    return Object.freeze({ recipient: user.position.beneficiary, amount: paid });
  }

  claimFrozen(caller, beneficiary, limit = UINT256_MAX) {
    identity(caller);
    amount(limit, 'claim limit');
    assert(this.#active, 'Wind-down has not started');
    const user = this.#user(beneficiary);
    const paid = min(this.position(beneficiary).frozenClaimable, limit);
    user.frozenPaid += paid;
    this.#frozenPaid += paid;
    this.#cash -= paid;
    return Object.freeze({ recipient: user.position.beneficiary, amount: paid });
  }

  claimEarnedFees(caller) {
    identity(caller);
    const paid = this.#feeReserve - this.#feesPaid;
    this.#feesPaid += paid;
    this.#cash -= paid;
    return Object.freeze({ recipient: this.#feeRecipient, amount: paid });
  }

  // Deliberately O(n), for tests and review only. No action above invokes it.
  audit() {
    let allocated = 0n;
    let claimable = 0n;
    let holders = 0n;
    for (const beneficiary of this.#users.keys()) {
      const value = this.position(beneficiary);
      allocated += value.cumulativeAllocation;
      claimable += value.frozenClaimable;
      if (value.frozenShares > 0n) holders++;
      assert(value.frozenClaimable >= 0n && value.reservedRemaining >= 0n);
      assert(value.frozenPaid <= value.cumulativeAllocation);
    }
    const reserves = this.#initialReserves - this.#reservedPaid;
    const earnedFees = this.#feeReserve - this.#feesPaid;
    const remainder = this.cumulativeGrossCash - allocated;
    assert.equal(this.#cash + this.#reservedPaid + this.#frozenPaid + this.#feesPaid, this.#initialCash + this.#received);
    assert.equal(this.#cash, reserves + earnedFees + claimable + remainder);
    assert(this.#cash >= reserves + earnedFees + claimable);
    if (this.#active && this.#totalShares > 0n) assert(remainder < holders, 'Pro-rata dust must be below one base unit per holder');
    return Object.freeze({
      active: this.#active, trigger: this.#trigger, totalShares: this.#totalShares,
      nativeCredits: this.#received, initialCash: this.#initialCash, cash: this.#cash,
      reservedRemaining: reserves, reservedPaid: this.#reservedPaid,
      feeRemaining: earnedFees, feePaid: this.#feesPaid,
      operatorFeesPaidBefore: this.#operatorFeesPaidBefore,
      newFeesEarned: 0n, frozenPaid: this.#frozenPaid,
      cumulativeAllocation: allocated, frozenClaimable: claimable,
      remainder, remainderKind: this.#totalShares === 0n ? 'unowned cash' : this.#active ? 'fractional pro-rata dust' : 'awaiting wind-down',
    });
  }
}

module.exports = { WindDownModel, UINT256_MAX };
