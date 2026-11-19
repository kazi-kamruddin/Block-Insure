import { Link } from "react-router-dom";

export default function BenefitClaimPage() {
  return (
    <section className="page-container">
      <div className="page-header-row">
        <div>
          <h1>Cancellation refunds</h1>
          <p>
            Open a policy to inspect its accepted refund schedule, actual paid installments and request status. Eligible refunds require cancellation, insurer review and a separately funded withdrawal.
          </p>
        </div>
      </div>
      <div className="action-row">
        <Link to="/user/policies">Review policies and refunds</Link>
      </div>
    </section>
  );
}
