import { formatEther } from "ethers";

export default function InsurerClaimStatement({ statement }) {
  if (!statement) return null;
  return <section className="card">
    <h3>Insurer claim statement</h3>
    <p>{statement.hospitalId} · {statement.invoiceNumber} · revision {statement.revision}</p>
    <p>{statement.service} · {statement.admission.slice(0, 10)} to {statement.discharge.slice(0, 10)}</p>
    <p>Submitted bill {formatEther(statement.grossWei)} ETH · policy #{statement.policyId}</p>
  </section>;
}
