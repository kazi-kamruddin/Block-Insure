import { formatEther } from "ethers";
import { formatDateOnly } from "../utils/dateFormat";

export default function InsurerClaimStatement({ statement }) {
  if (!statement) return null;

  return (
    <section className="card min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div>
          <span className="section-eyebrow">Hospital record statement</span>
          <h3 className="mt-1 mb-0">Insurer claim statement</h3>
        </div>
        <span className="dashboard-context-pill">Policy #{statement.policyId} · rev {statement.revision}</span>
      </div>
      <dl className="detail-kv-grid">
        <div>
          <dt>Hospital / Invoice</dt>
          <dd>{statement.hospitalId} · {statement.invoiceNumber}</dd>
        </div>
        <div>
          <dt>Service &amp; Dates</dt>
          <dd>{statement.service} · {formatDateOnly(statement.admission)} to {formatDateOnly(statement.discharge)}</dd>
        </div>
        <div>
          <dt>Submitted Bill</dt>
          <dd>{statement.grossWei !== undefined ? `${formatEther(statement.grossWei)} ETH` : "-"}</dd>
        </div>
      </dl>
    </section>
  );
}
