<?php
// This is the ALT copy, from a different project root, to prove
// per-service workspace binding actually reads from a different repo.

function chargePayment($userId, $amount) {
    $account = lookupAccount($userId);
    $result = processCharge($account, $amount);
    return $result;
}

function processCharge($account, $amount) {
    if ($account['balance'] < $amount) {
        throw new Exception("insufficient funds");
    }
    $account['balance'] -= $amount;
    return true;
}
