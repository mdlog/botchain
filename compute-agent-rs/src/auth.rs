// ── Request authentication (EIP-191) ────────────────────
//
// The agent's URL is published on-chain in AgentRegistry, so every route here
// is reachable by anyone and two of them spend the provider's key. Callers
// therefore prove wallet control by signing a scoped, timestamped challenge,
// and the recovered address is matched against the on-chain party entitled to
// make that particular call.

use std::str::FromStr;

use alloy::primitives::utils::keccak256;
use alloy::primitives::{Address, B256, Signature};
use serde::Deserialize;

/// Challenges outside this window are rejected. Without a freshness bound a
/// signature captured once grants access for the lifetime of the lease.
pub const MAX_CHALLENGE_AGE_SECS: i64 = 60;

/// Signed challenge accompanying an authenticated request.
#[derive(Debug, Clone, Deserialize)]
pub struct SignedAuth {
    pub address: String,
    /// hex (with or without 0x) EIP-191 personal_sign of the challenge.
    pub signature: String,
    /// unix seconds, as a string, embedded verbatim in the challenge.
    pub ts: String,
}

/// Binds a signature to one action, so a signature harvested from an `/execute`
/// call cannot be replayed against `/jobs/{id}/complete`.
#[derive(Debug, Clone, Copy)]
pub enum Scope {
    Terminal,
    Execute,
    Accept,
    Complete,
}

impl Scope {
    fn as_str(self) -> &'static str {
        match self {
            Scope::Terminal => "terminal",
            Scope::Execute => "execute",
            Scope::Accept => "accept",
            Scope::Complete => "complete",
        }
    }
}

/// The exact string the caller's wallet must `personal_sign`.
pub fn challenge(scope: Scope, job_id: u64, ts: &str) -> String {
    format!("botchain-{}:{}:{}", scope.as_str(), job_id, ts)
}

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("challenge timestamp must be unix seconds")]
    BadTimestamp,
    #[error("challenge expired or clock skew too large (max {MAX_CHALLENGE_AGE_SECS}s)")]
    StaleChallenge,
    #[error("malformed address")]
    BadAddress,
    #[error("signature invalid: {0}")]
    BadSignature(String),
    #[error("signature does not match address")]
    AddressMismatch,
    #[error("signer {signer} is not authorised for this job (expected {expected})")]
    NotAuthorised { signer: Address, expected: Address },
}

/// Verify a signed challenge and return the recovered signer.
///
/// This proves only *who* signed; the caller still has to decide whether that
/// address is allowed to act, via [`require_signer`].
pub fn verify(auth: &SignedAuth, scope: Scope, job_id: u64) -> Result<Address, AuthError> {
    let ts: i64 = auth.ts.parse().map_err(|_| AuthError::BadTimestamp)?;
    let now = chrono::Utc::now().timestamp();
    if (now - ts).abs() > MAX_CHALLENGE_AGE_SECS {
        return Err(AuthError::StaleChallenge);
    }

    let claimed = auth
        .address
        .parse::<Address>()
        .map_err(|_| AuthError::BadAddress)?;
    let recovered = recover_personal_sign(&challenge(scope, job_id, &auth.ts), &auth.signature)
        .map_err(|e| AuthError::BadSignature(e.to_string()))?;

    if recovered != claimed {
        return Err(AuthError::AddressMismatch);
    }
    Ok(recovered)
}

/// Assert the recovered signer is the on-chain party allowed to make the call
/// (`job.consumer` for consumer actions, `job.provider` for provider actions).
pub fn require_signer(signer: Address, expected: &str) -> Result<(), AuthError> {
    let expected = expected
        .parse::<Address>()
        .map_err(|_| AuthError::BadAddress)?;
    if signer != expected {
        return Err(AuthError::NotAuthorised { signer, expected });
    }
    Ok(())
}

/// Recover the signer address from an EIP-191 `personal_sign` signature.
pub fn recover_personal_sign(message: &str, sig_hex: &str) -> anyhow::Result<Address> {
    let prefix = format!("\x19Ethereum Signed Message:\n{}", message.len());
    let mut data = prefix.into_bytes();
    data.extend_from_slice(message.as_bytes());
    let hash: B256 = keccak256(data);

    let clean = sig_hex.trim_start_matches("0x");
    let sig =
        Signature::from_str(clean).map_err(|e| anyhow::anyhow!("invalid signature: {}", e))?;
    // The EIP-191 hash is computed above (matches viem's hashMessage), so recover
    // from that prehash DIRECTLY. recover_address_from_msg would re-apply the
    // prefix and always yield the wrong address.
    sig.recover_address_from_prehash(&hash)
        .map_err(|e| anyhow::anyhow!("recovery failed: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy::signers::SignerSync;
    use alloy::signers::local::PrivateKeySigner;

    fn signed(scope: Scope, job_id: u64, ts: &str, signer: &PrivateKeySigner) -> SignedAuth {
        let msg = challenge(scope, job_id, ts);
        let sig = signer.sign_message_sync(msg.as_bytes()).unwrap();
        SignedAuth {
            address: signer.address().to_string(),
            signature: alloy::hex::encode(sig.as_bytes()),
            ts: ts.to_string(),
        }
    }

    fn now() -> i64 {
        chrono::Utc::now().timestamp()
    }

    #[test]
    fn accepts_a_fresh_signature() {
        let key = PrivateKeySigner::random();
        let auth = signed(Scope::Execute, 7, &now().to_string(), &key);
        assert_eq!(verify(&auth, Scope::Execute, 7).unwrap(), key.address());
    }

    #[test]
    fn rejects_a_stale_challenge() {
        let key = PrivateKeySigner::random();
        let stale = (now() - MAX_CHALLENGE_AGE_SECS - 1).to_string();
        let auth = signed(Scope::Execute, 7, &stale, &key);
        assert!(matches!(
            verify(&auth, Scope::Execute, 7),
            Err(AuthError::StaleChallenge)
        ));
    }

    #[test]
    fn rejects_a_signature_replayed_across_scopes() {
        let key = PrivateKeySigner::random();
        let auth = signed(Scope::Execute, 7, &now().to_string(), &key);
        assert!(matches!(
            verify(&auth, Scope::Complete, 7),
            Err(AuthError::AddressMismatch)
        ));
    }

    #[test]
    fn rejects_a_signature_replayed_across_jobs() {
        let key = PrivateKeySigner::random();
        let auth = signed(Scope::Execute, 7, &now().to_string(), &key);
        assert!(matches!(
            verify(&auth, Scope::Execute, 8),
            Err(AuthError::AddressMismatch)
        ));
    }

    #[test]
    fn rejects_a_signer_who_is_not_the_expected_party() {
        let key = PrivateKeySigner::random();
        let other = PrivateKeySigner::random();
        assert!(require_signer(key.address(), &other.address().to_string()).is_err());
        assert!(require_signer(key.address(), &key.address().to_string()).is_ok());
    }
}
