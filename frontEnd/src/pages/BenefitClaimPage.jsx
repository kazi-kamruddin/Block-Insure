import { Link } from "react-router-dom";
export default function BenefitClaimPage() {
  return <section className="page-container"><h2>Cancellation refunds</h2>
    <p>Open a policy to inspect its accepted refund schedule, actual paid installments and request status. Eligible refunds require cancellation, insurer review and a separately funded withdrawal.</p>
    <Link to="/user/policies">Review policies and refunds</Link>
  </section>;
}
