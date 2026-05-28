import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function AuditorClaimLookupPage() {
  const [claimId, setClaimId] = useState("");
  const navigate = useNavigate();

  function handleSubmit(event) {
    event.preventDefault();

    if (!claimId.trim()) return;

    navigate(`/auditor/claims/${claimId.trim()}/history`);
  }

  return (
    <section className="page-container">
      <h2>Auditor Claim Lookup</h2>

      <p>
        Enter a claim ID to inspect its blockchain audit timeline. Example:
        after a fresh local test, use claim ID <strong>1</strong>.
      </p>

      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          Claim ID
          <input
            type="number"
            min="1"
            value={claimId}
            onChange={(event) => setClaimId(event.target.value)}
            placeholder="1"
            required
          />
        </label>

        <button type="submit">Open Audit Timeline</button>
      </form>
    </section>
  );
}