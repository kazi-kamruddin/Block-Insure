from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(r"E:\4-1\4100 thesis\project\Block-Insure")
OUT = ROOT / "reference" / "block-insure-supervisor-quick-read.pdf"

PAGE_W, PAGE_H = A4
NAVY = colors.HexColor("#15283B")
BLUE = colors.HexColor("#2166A5")
TEAL = colors.HexColor("#0E7C7B")
ORANGE = colors.HexColor("#D66A1F")
RED = colors.HexColor("#B33A3A")
GREEN = colors.HexColor("#2E7D5A")
INK = colors.HexColor("#1C2733")
MUTED = colors.HexColor("#566573")
PALE_BLUE = colors.HexColor("#EAF3FA")
PALE_TEAL = colors.HexColor("#E9F6F4")
PALE_ORANGE = colors.HexColor("#FFF3E8")
PALE_RED = colors.HexColor("#FBECEC")
PALE_GREY = colors.HexColor("#F3F5F7")
WHITE = colors.white


def register_fonts():
    regular = Path(r"C:\Windows\Fonts\arial.ttf")
    bold = Path(r"C:\Windows\Fonts\arialbd.ttf")
    italic = Path(r"C:\Windows\Fonts\ariali.ttf")
    if regular.exists() and bold.exists():
        pdfmetrics.registerFont(TTFont("Guide", str(regular)))
        pdfmetrics.registerFont(TTFont("Guide-Bold", str(bold)))
        if italic.exists():
            pdfmetrics.registerFont(TTFont("Guide-Italic", str(italic)))
        else:
            pdfmetrics.registerFont(TTFont("Guide-Italic", str(regular)))
        return "Guide", "Guide-Bold", "Guide-Italic"
    return "Helvetica", "Helvetica-Bold", "Helvetica-Oblique"


FONT, FONT_BOLD, FONT_ITALIC = register_fonts()


class GuideDocTemplate(BaseDocTemplate):
    def __init__(self, filename):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=17 * mm,
            rightMargin=17 * mm,
            topMargin=19 * mm,
            bottomMargin=16 * mm,
            title="Block-Insure Supervisor Quick Read",
            author="Block-Insure Project Team",
            subject="Plain-language defense guide with corrections and code evidence",
        )
        frame = Frame(
            self.leftMargin,
            self.bottomMargin,
            self.width,
            self.height,
            id="normal",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        self.addPageTemplates(PageTemplate(id="main", frames=[frame], onPage=self.decorate))

    def decorate(self, canvas, doc):
        page = canvas.getPageNumber()
        canvas.saveState()
        canvas.setFillColor(NAVY)
        canvas.rect(0, PAGE_H - 9 * mm, PAGE_W, 9 * mm, stroke=0, fill=1)
        canvas.setFont(FONT_BOLD, 7.6)
        canvas.setFillColor(WHITE)
        canvas.drawString(17 * mm, PAGE_H - 5.8 * mm, "BLOCK-INSURE / SUPERVISOR QUICK READ")
        canvas.setStrokeColor(colors.HexColor("#CCD5DC"))
        canvas.setLineWidth(0.4)
        canvas.line(17 * mm, 11.5 * mm, PAGE_W - 17 * mm, 11.5 * mm)
        canvas.setFont(FONT, 7.4)
        canvas.setFillColor(MUTED)
        canvas.drawString(17 * mm, 7.5 * mm, "Latest paper: reference/CSDE/4926_BlockInsure_CSDE_draft.pdf")
        canvas.drawRightString(PAGE_W - 17 * mm, 7.5 * mm, f"Page {page}")
        canvas.restoreState()


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverTitle", fontName=FONT_BOLD, fontSize=28, leading=32,
    textColor=WHITE, alignment=TA_LEFT, spaceAfter=10,
))
styles.add(ParagraphStyle(
    name="CoverSub", fontName=FONT, fontSize=12, leading=17,
    textColor=colors.HexColor("#DDEAF3"), alignment=TA_LEFT,
))
styles.add(ParagraphStyle(
    name="H1x", fontName=FONT_BOLD, fontSize=19, leading=23,
    textColor=NAVY, spaceBefore=2, spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="H2x", fontName=FONT_BOLD, fontSize=13.2, leading=16,
    textColor=BLUE, spaceBefore=8, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="H3x", fontName=FONT_BOLD, fontSize=10.5, leading=13,
    textColor=TEAL, spaceBefore=5, spaceAfter=3,
))
styles.add(ParagraphStyle(
    name="Bodyx", fontName=FONT, fontSize=9.25, leading=13.1,
    textColor=INK, spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="Smallx", fontName=FONT, fontSize=7.8, leading=10.5,
    textColor=INK, spaceAfter=2,
))
styles.add(ParagraphStyle(
    name="Tinyx", fontName=FONT, fontSize=6.8, leading=8.8,
    textColor=INK,
))
styles.add(ParagraphStyle(
    name="Bulletx", fontName=FONT, fontSize=9.0, leading=12.5,
    leftIndent=13, firstLineIndent=-8, bulletIndent=2, textColor=INK,
    spaceAfter=2.5,
))
styles.add(ParagraphStyle(
    name="Calloutx", fontName=FONT, fontSize=9.0, leading=12.6,
    textColor=INK, leftIndent=7, rightIndent=7, spaceBefore=2, spaceAfter=2,
))
styles.add(ParagraphStyle(
    name="Formula", fontName=FONT_BOLD, fontSize=10.2, leading=14,
    alignment=TA_CENTER, textColor=NAVY, spaceBefore=3, spaceAfter=5,
))


story = []


def para(text, style="Bodyx"):
    story.append(Paragraph(text, styles[style]))


def h1(text):
    story.append(Paragraph(text, styles["H1x"]))


def h2(text):
    story.append(Paragraph(text, styles["H2x"]))


def h3(text):
    story.append(Paragraph(text, styles["H3x"]))


def bullets(items):
    for item in items:
        story.append(Paragraph(f"- {item}", styles["Bulletx"]))


def callout(label, text, kind="blue"):
    palette = {
        "blue": (PALE_BLUE, BLUE),
        "green": (PALE_TEAL, GREEN),
        "orange": (PALE_ORANGE, ORANGE),
        "red": (PALE_RED, RED),
        "grey": (PALE_GREY, MUTED),
    }
    bg, edge = palette[kind]
    content = Paragraph(f"<b>{label}</b> {text}", styles["Calloutx"])
    box = Table([[content]], colWidths=[174 * mm])
    box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.7, edge),
        ("LINEBEFORE", (0, 0), (0, -1), 3.2, edge),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(box)
    story.append(Spacer(1, 4))


def formula(text):
    story.append(Paragraph(text, styles["Formula"]))


def data_table(headers, rows, widths=None, font_size=7.4):
    def cell(value, header=False):
        style = ParagraphStyle(
            name=f"cell-{id(value)}-{header}", parent=styles["Smallx"],
            fontName=FONT_BOLD if header else FONT,
            fontSize=font_size, leading=font_size + 2.3,
            textColor=WHITE if header else INK,
        )
        return Paragraph(str(value), style)

    table_data = [[cell(v, True) for v in headers]] + [[cell(v) for v in row] for row in rows]
    table = Table(table_data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#C9D2D9")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PALE_GREY]),
    ]))
    story.append(table)
    story.append(Spacer(1, 5))


def page():
    story.append(PageBreak())


# Cover
cover = Table([[
    Paragraph("BLOCK-INSURE", styles["CoverTitle"]),
], [
    Paragraph("Supervisor Quick Read", styles["CoverTitle"]),
], [
    Paragraph(
        "A plain-language guide built from our discussion: what you understood correctly, "
        "what needed correction, what the code actually does, and the safest way to present it.",
        styles["CoverSub"],
    )
]], colWidths=[174 * mm], rowHeights=[34 * mm, 26 * mm, 37 * mm])
cover.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), NAVY),
    ("LEFTPADDING", (0, 0), (-1, -1), 12 * mm),
    ("RIGHTPADDING", (0, 0), (-1, -1), 12 * mm),
    ("TOPPADDING", (0, 0), (-1, -1), 4 * mm),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * mm),
]))
story.append(Spacer(1, 27 * mm))
story.append(cover)
story.append(Spacer(1, 12 * mm))
para("MEETING EDITION / 08 SEPTEMBER 2026", "H3x")
callout(
    "Use this as a defense guide.",
    "It deliberately avoids saying that Block-Insure proves real-world fraud, clinical truth, "
    "production solvency, or public-chain performance. It explains exactly what was demonstrated.",
    "orange",
)
para("Authoritative paper: reference/CSDE/4926_BlockInsure_CSDE_draft.pdf (byte-identical to reference/CSDE/main.pdf).", "Smallx")
para("Project workspace: Block-Insure", "Smallx")

page()
h1("1. The project in one minute")
para(
    "Block-Insure is an Ethereum-compatible healthcare-insurance prototype. It combines policy and settlement contracts, "
    "off-chain healthcare registry data, a probabilistic routing model, deterministic integrity rules, two commit-reveal oracle workers, "
    "human auditor fallback, confidential evidence, and reserve-aware payout.")
callout(
    "Your central understanding was correct:",
    "the public dataset gives realistic healthcare structure, controlled mutations give exact test scenarios, "
    "and the blockchain gives exact workflow and payment state.",
    "green",
)
h2("Three different kinds of truth")
data_table(
    ["Source", "What it supports", "What it cannot prove"],
    [
        ["Kaggle PotentialFraud", "Weak provider-level risk and realistic distributions", "Fraud truth for each claim"],
        ["Eight controlled mutations", "Exact knowledge of what field we deliberately changed", "Coverage of unknown real attackers"],
        ["Smart-contract state", "Exact versions, votes, reservations, funding and withdrawal", "Whether a medical event was clinically true"],
    ],
    widths=[43 * mm, 65 * mm, 66 * mm],
)
callout(
    "Supervisor-safe thesis:",
    "The contribution is a reproducible hybrid evaluation architecture and an auditable settlement workflow, not proof of universal fraud detection.",
    "blue",
)
h2("Paper version to open")
bullets([
    "Use reference/CSDE/4926_BlockInsure_CSDE_draft.pdf.",
    "reference/CSDE/main.pdf is the same final build.",
    "The editable source is reference/CSDE/main.tex plus numbered section files.",
    "Do not present output/pdf/block-insure-six-page-paper.pdf as the latest version.",
])

page()
h1("2. System and data architecture")
h2("Seven principal Solidity modules")
data_table(
    ["Module", "Responsibility", "Location"],
    [
        ["InsuranceManager", "Claim lifecycle, oracle result, appeals, settlement withdrawal", "contracts/contracts/InsuranceManager.sol"],
        ["PolicyEconomics", "Policy rules, coverage reservation, settlement and reserve math", "contracts/contracts/PolicyEconomics.sol"],
        ["OracleCoordinator", "Versioned requests, commit-reveal and exact quorum", "contracts/contracts/OracleCoordinator.sol"],
        ["ClaimAdjudicator", "Auditor assignment, voting and review result", "contracts/contracts/ClaimAdjudicator.sol"],
        ["EvidenceRegistry", "Evidence identities and anchored Merkle tree heads", "contracts/contracts/EvidenceRegistry.sol"],
        ["PolicyBenefitsManager", "Published benefits, benefit requests and settlement", "contracts/contracts/PolicyBenefitsManager.sol"],
        ["ProtocolDeploymentRegistry", "Records deployed protocol components", "contracts/contracts/ProtocolDeploymentRegistry.sol"],
    ],
    widths=[38 * mm, 78 * mm, 58 * mm],
    font_size=7.0,
)
callout(
    "Correction:",
    "The paper names seven principal modules, but the current deployment also contains HospitalVerificationRegistry and BankIdentityRegistry. "
    "So do not claim that the entire current deployment contains only seven contracts.",
    "orange",
)
h2("Evidence, registry and failure containment")
bullets([
    "The browser encrypts evidence with AES-256-GCM. The ciphertext remains off-chain.",
    "Authenticated metadata binds the evidence to claim ID, claim version, uploader and evidence type.",
    "Proxy re-encryption delegates key access to an authorized auditor without giving the proxy a normal decrypt operation.",
    "EvidenceRegistry anchors identities and Merkle tree heads; per-claim and append-only histories provide inclusion evidence.",
    "Oracle requests snapshot the claim version, registry version/root, model version, quorum and eligible workers.",
    "Conflict or timeout cannot authorize payment. Underfunding produces FUNDING_REQUIRED rather than silently paying.",
])
callout(
    "Hard boundary:",
    "A hash or Merkle proof proves integrity and inclusion relative to a root. It does not prove that the medical document is truthful.",
    "red",
)

page()
h1("3. The hybrid dataset: original, engineered and used")
h2("What came from Kaggle")
data_table(
    ["Raw file", "Original role", "Local size"],
    [
        ["Train-1542865627584.csv", "Provider ID and PotentialFraud label", "0.08 MiB"],
        ["Train_Beneficiarydata-1542865627584.csv", "Beneficiary demographics and chronic conditions", "10.91 MiB"],
        ["Train_Inpatientdata-1542865627584.csv", "Inpatient claims", "8.18 MiB"],
        ["Train_Outpatientdata-1542865627584.csv", "Outpatient claims", "73.81 MiB"],
    ],
    widths=[65 * mm, 83 * mm, 26 * mm],
)
bullets([
    "Total source claims: 558,211 (40,474 inpatient and 517,737 outpatient).",
    "Providers: 5,410. Beneficiaries: 138,556.",
    "The native joins are Provider and BeneID. We did not invent a cross-source fraud label.",
])
h2("What we engineered")
bullets([
    "A common Block-Insure claim/registry JSON schema with hashed aliases and invoice identities.",
    "Claim setting and treatment mapping: inpatient to HOSPITALIZATION, outpatient to DIAGNOSTIC.",
    "Source amount as reimbursement plus deductible; demo amount as max(amount / 10,000, 0.0001). This is scaling, not currency conversion.",
    "Age band, chronic-condition count, procedure/diagnosis mapping, repeated activity, provider and claimant velocity signals, and provenance fields.",
    "Provider-disjoint 64/16/20 split using seed 20260828. Amount and velocity thresholds come from training only.",
    "Eight deterministic attack scenarios, with about 12% injection in train/calibration and 50% attack selection in the test counterfactual set.",
])
h2("Where the data goes")
data_table(
    ["Artifact", "Use"],
    [
        ["processed/train.jsonl", "Offline training and feature thresholds"],
        ["processed/calibration.jsonl", "Calibration and operating-point selection"],
        ["processed/test-untouched.jsonl", "Untouched reference claims"],
        ["processed/test-attacks.jsonl", "Paired controlled-attack evaluation"],
        ["runtime/hybrid-primary.jsonl", "4,995 deterministic real-derived runtime rows"],
    ],
    widths=[72 * mm, 102 * mm],
)
callout(
    "Runtime distinction:",
    "The full 558,211-claim dataset is used offline. Runtime seeds 4,995 real-derived rows plus five stable demo presets, for 5,000 registry records. "
    "Only the Merkle root is anchored on-chain.",
    "blue",
)

page()
h1("4. The eight controlled attacks")
para("These are deterministic changes to copies of real-derived claims. They are not observed criminal cases and they are not attacks against Ethereum itself.")
data_table(
    ["Scenario", "Deliberate change", "Expected routing evidence"],
    [
        ["USED_INVOICE", "Set invoice/record status to USED", "Hard integrity failure"],
        ["CANCELLED_RECORD", "Set record and invoice to CANCELLED", "Hard integrity failure"],
        ["INFLATED_AMOUNT", "Set bill to 1.6 times expected maximum", "Amount anomaly/manual review"],
        ["DATE_MISMATCH", "Move invoice date 45 days after discharge", "Date anomaly/manual review"],
        ["BLACKLISTED_HOSPITAL", "Set provider licence to BLACKLISTED", "Hard integrity failure"],
        ["NEAR_DUPLICATE", "Activate similarity advisory", "Manual-review abstention"],
        ["PROVIDER_COMPROMISE", "Activate provider-velocity compromise signal", "Primarily probabilistic detection"],
        ["NOISY_RECORD", "Mark invoice suspicious and record noisy", "Manual-review abstention"],
    ],
    widths=[43 * mm, 72 * mm, 59 * mm],
    font_size=6.9,
)
callout(
    "Meaning of detected:",
    "A positive result means rejected at oracle verification or escalated to human review. It does not mean convicted as fraud.",
    "orange",
)
h2("Where 55.25%, 88.74% and 100% happen")
para(
    "They are calculated by the offline command-line evaluator backEnd/scripts/evaluateHybridDataset.js. It reads test-untouched.jsonl and "
    "test-attacks.jsonl, extracts the same 18-feature schema, applies the frozen protocol model and triage rules, and compares three temporary configurations.")
data_table(
    ["Configuration", "Controlled-attack routing recall", "Untouched escalation"],
    [
        ["Model only", "55.25%", "0.0037%"],
        ["Rules only", "88.74%", "7.7845%"],
        ["Combined runtime policy", "100%", "7.7881%"],
    ],
    widths=[65 * mm, 59 * mm, 50 * mm],
)
callout(
    "Your confidence interpretation was mostly right:",
    "If a runtime claim produces the same observable feature vector under the same frozen model and policy, routing is deterministic. "
    "The uncertainty is whether future real attacks expose the same features. The offline result therefore supports the mechanism, not universal detection.",
    "green",
)

page()
h1("5. Methodology A: provider-risk estimation")
h2("Step 1 - build one profile per provider")
para("All inpatient and outpatient claims belonging to provider p are grouped. The nine-value provider profile g_p contains:")
data_table(
    ["Symbol", "Meaning"],
    [
        ["n_p", "Total claim count"],
        ["u_p", "Unique beneficiary count"],
        ["mean A_p", "Mean original claim amount"],
        ["max A_p", "Maximum original claim amount"],
        ["mean I_p", "Inpatient proportion"],
        ["mean P_p", "Procedure-code proportion"],
        ["mean R_p", "Repeat-claim proportion"],
        ["mean H_p", "Mean chronic-condition count"],
        ["mean V_p", "Beneficiary-activity anomaly proportion"],
    ],
    widths=[42 * mm, 132 * mm],
    font_size=7.2,
)
callout(
    "Correction:",
    "A provider ID can represent a hospital, clinic, physician or other healthcare provider. Do not call every provider a hospital.",
    "orange",
)
h2("Step 2 - convert numbers to Boolean features")
formula("x_pj = 1 when g_pj is at or above the training-set 75th percentile; otherwise x_pj = 0")
para(
    "For claim count, a provider in approximately the top 25% receives high_claim_volume = 1; the other providers receive 0. "
    "The threshold is learned from training providers only, which avoids test leakage.")
h2("Step 3 - Bernoulli Naive Bayes")
para(
    "The name is Bernoulli Naive Bayes, not boundary Naive Bayes. It learns how often each high/low Boolean feature occurs among "
    "PotentialFraud Yes and No providers. Laplace smoothing alpha = 1 prevents zero probabilities. The model emits a raw risk probability.")
h2("Step 4 - Platt calibration and final flag")
para(
    "Platt calibration changes the raw score into a better-adjusted probability. It does not directly output zero or one. "
    "A threshold selected on calibration providers then converts the probability into a binary risk flag.")
formula("calibrated probability >= 0.35  ->  higher-risk audit flag")
callout(
    "Correct label boundary:",
    "This is a weak provider-level audit-prioritization flag, not proof that a provider or individual claim committed fraud.",
    "red",
)

page()
h1("6. Provider-risk results: what they really say")
para("The final BNB was tested on 1,085 previously unseen providers.")
data_table(
    ["Result", "Value", "Plain meaning"],
    [
        ["TP / TN / FP / FN", "41 / 914 / 87 / 43", "41 labelled-risk providers found; 43 missed; 87 extra flags"],
        ["Precision", "32.03%", "About one in three flags matched the weak positive label"],
        ["Recall", "48.81%", "It found about half of the weak positive labels"],
        ["F1", "38.68%", "Moderate balance of precision and recall"],
        ["ROC-AUC", "87.97%", "Good cross-threshold ranking ability"],
        ["PR-AUC", "35.76%", "Positive-class ranking remains limited under imbalance"],
    ],
    widths=[39 * mm, 29 * mm, 106 * mm],
)
h2("Why 92.26% majority accuracy is bad")
para(
    "A classifier that says every provider is negative obtains 92.26% accuracy because positives are rare, yet its recall and F1 are both zero. "
    "That is why accuracy alone would be misleading.")
h2("Comparators and feature ablation")
bullets([
    "Ordinary logistic regression reached F1 46.23%; class-weighted logistic reached 45.77%. Both exceeded BNB at the selected operating point.",
    "BNB was retained as a frozen, simple, interpretable primary artifact - not because it was the best classifier.",
    "Removing volume/activity caused the largest ranking loss, so that feature group carried the strongest signal.",
    "Removing coarse setting/clinical features improved F1, suggesting redundancy/noise in this Boolean encoding, not clinical irrelevance.",
    "One thousand provider bootstraps estimate uncertainty; provider-disjoint splitting prevents one provider appearing across train and test.",
])
callout(
    "Final defense line:",
    "The real-derived model shows that historical provider behavior contains useful ranking information, but its precision and recall rule out autonomous fraud judgment.",
    "blue",
)

page()
h1("7. Methodology B: authority-aware claim routing")
h2("Three costs, not three routing cases")
data_table(
    ["Symbol", "Configured value", "Meaning"],
    [
        ["C_m", "10", "Relative cost of missing an attack"],
        ["C_f", "1", "Relative cost of escalating a legitimate claim"],
        ["C_r", "0.25", "Relative operational cost of manual review"],
    ],
    widths=[35 * mm, 40 * mm, 99 * mm],
)
callout(
    "Correction:",
    "These are relative experimental costs, not money amounts. The actual routing cases are reject oracle verification, manual review and auto-verify recommendation.",
    "orange",
)
h2("Economic and capacity thresholds")
formula("t_e = (C_r + C_f) / (C_m + C_f) = 1.25 / 11 = 0.113636")
para("t_e, pronounced 't sub e', is the economic review threshold. From cost alone, risk of about 11.36% makes review preferable.")
formula("t_capacity = 0.217969;  t_m = max(t_e, t_capacity) = 0.217969")
para(
    "The calibration-set capacity threshold represents a nominal 20% review plan, so the stricter final model threshold is about 21.80%. "
    "It is an offline operating point, not a live queue guarantee; explicit anomalies can push actual review above 20%.")
h2("The 18-feature runtime model")
para(
    "This is not the provider-risk model. It evaluates one claim using registry presence/matches, invoice and amount conditions, treatment/date status, "
    "licence status, repeat/velocity patterns, near duplication and noisy data. The frozen artifact is backEnd/model-params.json.")

page()
h1("8. Routing authority and oracle consensus")
h2("Routing order")
formula("If H(x)=1 -> negative oracle verification")
formula("Else if A(x)=1 or calibrated p >= 21.80% -> manual review")
formula("Else -> auto-verify recommendation")
h3("H(x): authoritative hard failure")
para(
    "Examples are missing registry record, hospital mismatch, invoice-hash mismatch, invalid/used/cancelled record and blacklisted provider. "
    "A low model probability cannot override a used invoice.")
h3("A(x): anomaly requiring interpretation")
para(
    "Examples are claim exceeding the registry bill, bill-range anomaly, date mismatch, near duplicate and noisy record. "
    "They may have innocent explanations, so the system abstains to human review.")
callout(
    "Correction:",
    "'Reject oracle' means automatic verification of the claim returns negative; it does not mean the oracle worker is rejected. "
    "A negative exact quorum leads to ORACLE_FAILED and makes manual review available, not an immediate legal fraud conviction.",
    "red",
)
h2("Kappa_o, d and exact quorum")
formula("kappa_o = H(request, claimVersion, registryVersion, verified, resultHash, modelVersion, salt_o)")
para(
    "kappa_o is one worker's hidden commitment. The secret salt prevents another worker from seeing and copying the answer before reveal. "
    "During reveal, the contract recomputes the commitment to prove the worker did not change its answer.")
formula("d = H(verified, resultHash, claimVersion, registryVersion, modelVersion)")
para(
    "d is the comparable revealed-result digest. Two identical d values mean the workers agree on the exact result and versions. "
    "Neither kappa_o nor d is itself the quorum; the count of two matching d values establishes quorum. Conflict or timeout cannot pay.")
callout(
    "Authority principle:",
    "Probability may defer a claim to humans but may not reject it as fraud. Exact registry facts can block verification; exact oracle agreement can authorize the next contract step; auditors resolve uncertain cases.",
    "green",
)

page()
h1("9. Methodology C: settlement, reserve and evidence")
h2("Settlement arithmetic")
formula("q = min(A, floor(A*d/10,000), D)")
formula("L = floor((A-q)*s/10,000);  R = A-L")
data_table(
    ["Symbol", "Meaning"],
    [
        ["A", "Approved claim amount"],
        ["d / D", "Deductible rate in basis points / deductible cap"],
        ["q", "Actual capped deductible"],
        ["s", "Insurer share in basis points"],
        ["L", "Insurer liability"],
        ["R", "Claimant responsibility, including deductible and uncovered share"],
    ],
    widths=[40 * mm, 134 * mm],
)
h3("Example")
para(
    "For A = 1 ETH, d = 10%, D = 0.02 ETH and s = 80%: q = 0.02 ETH, amount after deductible = 0.98 ETH, "
    "L = 0.784 ETH and R = 0.216 ETH. Solidity uses integer wei arithmetic and floors remainders.")
h2("Coverage reservation versus treasury cash")
formula("reserved + settled + new liability <= policy coverage limit")
callout(
    "Major correction:",
    "A low treasury balance does not prevent claim submission. Submission fails only if policy rules or remaining policy coverage fail. "
    "If an approved claim lacks liquid contract funds later, it enters FUNDING_REQUIRED until funded, then PAYOUT_READY.",
    "red",
)
h2("Protected treasury balance")
formula("T_min = U + B + floor(E*r/10,000)")
para("U is approved unfunded liability, B is the fixed buffer, E is active exposure and r is the configured reserve ratio.")

page()
h1("10. What the configured 5% reserve ratio means")
callout(
    "Simple meaning:",
    "For every 100 ETH of active policy exposure, the configuration protects approximately 5 ETH as reserve capital. "
    "For 1,000 ETH exposure, 5% corresponds to 50 ETH.",
    "blue",
)
para("The 1,000 ETH is total active coverage exposure, not a promise that all 1,000 ETH will be paid at once.")
h2("Offline stress experiment")
bullets([
    "Portfolio: 1,000 policies with 1 ETH coverage each; exposure E = 1,000 ETH.",
    "Capital at 5%: C = E*r = 50 ETH.",
    "Five thousand simulated years per scenario, seed 410034.",
    "Claim count K follows a Poisson model; claim severity X follows a lognormal model and is capped at 1 ETH.",
    "Every simulated claim is passed through the 10% deductible, 0.02 ETH cap and 80% insurer-share formula.",
    "Target: shortfall probability no more than 1%.",
])
formula("P_short = fraction of simulated years in which total liability S exceeds capital C")
formula("ES = average amount missing, calculated only among failed years")
h2("Table VII in plain language")
data_table(
    ["Scenario", "Failure at 5%", "Average shortage when failed", "Smallest tested passing ratio"],
    [
        ["Baseline", "0.22%", "0.6076 ETH", "5%"],
        ["High frequency", "100%", "25.7306 ETH", "10%"],
        ["Heavy tail", "28.38%", "3.3047 ETH", "8%"],
        ["Combined stress", "100%", "44.0556 ETH", "15%"],
    ],
    widths=[42 * mm, 34 * mm, 55 * mm, 43 * mm],
    font_size=6.9,
)
callout(
    "Your gist was correct, with one limit:",
    "Higher expected frequency/severity may require more reserve. The study does not universally recommend 15%. "
    "It says 8%, 10% and 15% were the smallest values in the tested grid that met the synthetic 1% target in those scenarios.",
    "green",
)

page()
h1("11. Evidence experiments")
h2("Three mechanisms tested")
data_table(
    ["Mechanism", "What it provides", "What it does not prove"],
    [
        ["AES-256-GCM", "Document confidentiality and tamper detection; claim/version metadata authenticated", "Clinical truth or production key custody"],
        ["Proxy re-encryption", "Delegated recovery of an encrypted document key by an authorized auditor", "Erasure of plaintext already recovered before revocation"],
        ["Merkle inclusion proof", "Evidence event belongs to the history committed by a root", "Truth of the event's medical content"],
    ],
    widths=[43 * mm, 78 * mm, 53 * mm],
    font_size=7.0,
)
h2("Local benchmark headlines")
bullets([
    "Synthetic document sizes: 16 KiB PDF, 256 KiB PDF and 1 MiB scanned image; 30 repetitions.",
    "For 1 MiB: AES-GCM p95 encryption/decryption = 3.432/3.341 ms; ciphertext overhead = 28 bytes.",
    "PRE capsule = 932 bytes; one-recipient p95 transform/decryption = 15.48/19.48 ms.",
    "These are local cryptographic and in-process storage timings, not public IPFS or internet timings.",
])
h2("Eight evidence failure checks")
bullets([
    "Ciphertext bit flip; wrong claim/version authenticated metadata; replaced encrypted receipt; substituted CID.",
    "Gateway unavailable; corrupted Merkle proof; revoked grant; stale key version after rotation.",
    "All 8/8 were rejected or reported by the intended control. This is sampled failure coverage, not proof that every possible attack is solved.",
])

page()
h1("12. Results section: quick roll")
data_table(
    ["Subsection", "Headline", "Limitation to state"],
    [
        ["Provider Risk", "BNB ROC-AUC 0.8797, PR-AUC 0.3576; logistic comparators better at the selected point", "Provider prioritization only; weak label; moderate precision/recall"],
        ["Paired Attack Routing", "Combined 100% of 54,705 injected attacks; 7.7881% untouched escalation", "Scenario-bounded routing, not real-fraud accuracy"],
        ["Whole-Protocol", "Contract/backend/oracle/adapter tests passed; both automatic and manual flows settled", "Branch coverage 65.03%; concurrency 50 lost 11 submissions"],
        ["Deployment and Static Security", "Thirteen Slither observations removed; no unrestricted withdrawal confirmed", "Local deployment only; static analysis is not a professional audit"],
        ["Reserve Adequacy", "5% passes baseline; tested stress operating points rise to 8-15%", "Synthetic advisory study, not statutory actuarial capital"],
    ],
    widths=[39 * mm, 79 * mm, 56 * mm],
    font_size=6.8,
)
h2("Whole-protocol numbers worth remembering")
bullets([
    "Tests passed: 127 contract, 63 backend, 13 oracle and 8 adapter tests.",
    "Coverage: statements 93.79%, branches 65.03%, functions 90.59%, lines 94.39%.",
    "Eight sampled mutants were detected; this is useful assurance but not exhaustive mutation analysis.",
    "Concurrency 20: 20/20 succeeded, p95 412.74 ms. Concurrency 50: 39/50 succeeded, p95 790.66 ms.",
    "Merkle root anchoring cost 43,851 gas versus 11,402,190 gas for 500 individual hashes: 99.62% storage-gas saving.",
    "InsuranceManager bytecode was 24,278 bytes, only 298 bytes below the EIP-170 limit: a real modularity/deployability risk.",
])
h2("Deployment and Slither")
para(
    "The seven-module suite deployed locally on Hardhat. Sepolia and Amoy cells remain blank, so no public-network deployment is claimed. "
    "Slither observations dropped from 108 to 95 after hardening. The remaining 95 are patterns for triage, not 95 confirmed vulnerabilities. "
    "Manual review found no unresolved exploitable defect in that scope, but this is not formal verification or a professional audit.")

page()
h1("13. What to carry on your phone")
callout(
    "Do not push the 1.3 GiB processed dataset just for a meeting.",
    "Git ignores the raw CSVs, processed JSONL files and runtime JSONL intentionally. Large generated data is reproducible and unsuitable for ordinary Git history.",
    "orange",
)
h2("Minimum supervisor pack - best balance")
data_table(
    ["Priority", "File", "Why show it"],
    [
        ["1", "reference/CSDE/4926_BlockInsure_CSDE_draft.pdf", "The authoritative six-page paper"],
        ["2", "reference/block-insure-supervisor-quick-read.pdf", "This compact explanation and correction guide"],
        ["3", "backEnd/datasets/hybrid-v1/README.md", "Plain-language source, label boundary, split, outputs and commands"],
        ["4", "backEnd/datasets/hybrid-v1/manifest.json", "Hashes, counts, seed, versions and expected raw files"],
        ["5", "backEnd/scripts/buildHybridDataset.js", "Proves the join, split, thresholds, attacks and generated files"],
        ["6", "backEnd/services/hybridDatasetAdapterService.js", "Proves feature/schema engineering and attack mutation logic"],
        ["7", "backEnd/scripts/evaluateHybridDataset.js", "Proves provider evaluation and 55/89/100 routing ablation"],
        ["8", "backEnd/evaluation-results/hybrid-v1-evaluation.json", "Machine-readable final metrics; only about 21 KiB"],
        ["9", "backEnd/evaluation-results/provider-risk-real-v1.0.0.json", "Frozen real-derived provider model; only about 5 KiB"],
        ["10", "paper-evidence/tables/controlled-attack-scenarios.csv", "Tiny scenario-by-scenario result table"],
    ],
    widths=[16 * mm, 91 * mm, 67 * mm],
    font_size=6.6,
)
h2("Raw evidence to copy directly to the phone")
para(
    "For a no-laptop meeting, copy the four original Kaggle CSVs directly from backEnd/datasets/hybrid-v1/raw/ to a phone folder or cloud drive. "
    "Together they are about 93 MiB, so this is practical. At minimum, carry the 0.08 MiB provider-label CSV plus the dataset README and manifest; "
    "the other three files prove the beneficiary, inpatient and outpatient source structure.")
h2("One generated runtime file, if you want a real row")
para(
    "runtime/hybrid-primary.jsonl is about 9.43 MiB and contains the 4,995 real-derived runtime rows. It is small enough for a phone and shows the final application schema. "
    "Avoid carrying the four processed JSONL files unless necessary: they total about 1.26 GiB.")

page()
h1("14. GitHub visibility and the right publication strategy")
h2("Why the dataset is absent")
para("The root .gitignore contains these deliberate rules:")
bullets([
    "backEnd/datasets/hybrid-v1/raw/*.csv",
    "backEnd/datasets/hybrid-v1/processed/*.jsonl",
    "backEnd/datasets/hybrid-v1/runtime/*.jsonl",
    "reference/*, with only three named Markdown references currently re-included.",
])
callout(
    "Important for this PDF:",
    "Because reference/* is ignored, this newly generated PDF will also remain local unless you explicitly change the ignore policy, force-add it, "
    "or upload/copy it to your phone separately.",
    "red",
)
h2("Recommended approach")
bullets([
    "Keep large raw/generated datasets out of normal Git history.",
    "Keep README.md, manifest.json, generation/evaluation code and small result artifacts in GitHub.",
    "For supervisor viewing, copy the raw four-file Kaggle source and the 9.43 MiB runtime JSONL directly to a phone/cloud folder.",
    "If public download is needed later, use a versioned release asset, institutional storage or data registry with hashes from manifest.json.",
    "Use Git LFS only if the team intentionally wants to maintain large binary/data artifacts and accepts its storage/bandwidth limits.",
])
h2("A clean folder layout for the phone")
para("Create a phone folder named Block-Insure-Supervisor with:")
bullets([
    "01-paper.pdf",
    "02-supervisor-quick-read.pdf",
    "03-dataset-readme.md and 04-manifest.json",
    "05-original-kaggle/ containing the four CSVs",
    "06-engineered-runtime/hybrid-primary.jsonl",
    "07-results/ containing the two evaluation JSON files and controlled-attack CSV",
    "08-code/ containing the builder, adapter and evaluator JavaScript files.",
])

page()
h1("15. Five-minute supervisor explanation")
callout(
    "Opening:",
    "Block-Insure is not just a fraud classifier. It is an auditable healthcare-insurance workflow joining versioned policy economics, "
    "off-chain registry verification, probabilistic risk, deterministic integrity rules, commit-reveal oracle consensus, human review and funded settlement.",
    "blue",
)
h2("Dataset")
para(
    "We imported 558,211 Medicare-derived claims from four Kaggle files. PotentialFraud is only a provider-level weak label, so we used it only for provider-risk prioritization. "
    "We joined providers, beneficiaries, inpatient and outpatient claims through native identifiers, engineered one common protocol schema, split by provider, and generated paired controlled attacks without relabelling the public claims as proven fraud.")
h2("Provider model")
para(
    "Each provider becomes nine aggregate statistics. Training-set upper quartiles convert them to Boolean features for Bernoulli Naive Bayes. "
    "Platt calibration produces an adjusted probability and a calibration-only 0.35 threshold produces an audit flag. On 1,085 held-out providers, ROC-AUC was 0.8797 but precision and recall were moderate, and logistic regression was better at the chosen point. So the claim is prioritization, not adjudication.")
h2("Runtime routing")
para(
    "A separate frozen 18-feature model scores an individual claim. Hard registry contradictions can prevent positive oracle verification. Fuzzy or committed anomalies, or probability above 21.80%, defer to review. The model cannot independently reject fraud. Two oracle workers must commit and reveal exactly matching version-bound results; conflict or timeout cannot pay.")
h2("Settlement and evidence")
para(
    "The contract computes a capped deductible and insurer share, reserves liability against the policy coverage limit, and moves an approved but underfunded claim to FUNDING_REQUIRED until funded. "
    "Evidence remains AES-GCM encrypted off-chain; proxy re-encryption delegates access and Merkle roots bind evidence history.")
h2("Evaluation and limitations")
para(
    "Combined routing covered all 54,705 injected attacks at 7.7881% untouched escalation, but that is scenario coverage. Both complete settlement paths worked locally. "
    "The study also exposed 65.03% branch coverage, concurrency-50 failures, 298 bytes of bytecode headroom, no public-network run and reserve failure under stress. These negatives bound the contribution honestly.")

page()
h1("16. Corrections to remember under questioning")
data_table(
    ["Tempting statement", "Say this instead"],
    [
        ["All Kaggle rows are real fraud claims.", "They are real-derived claims; PotentialFraud is a weak provider label."],
        ["The model catches 55% of real fraud.", "The frozen protocol model routes 55.25% of controlled attacks when evaluated alone."],
        ["Combined system has 100% fraud accuracy.", "Combined policy routes 100% of eight predefined deterministic attack scenarios."],
        ["Platt calibration gives the final 0/1 label.", "Platt gives an adjusted probability; a threshold creates the binary flag."],
        ["Every provider is a hospital.", "A provider may be an institution, clinic, physician or another service provider."],
        ["A low treasury balance blocks claim submission.", "Remaining policy coverage can block submission; treasury shortage later produces FUNDING_REQUIRED."],
        ["The reserve study recommends exactly 15%.", "15% was the smallest tested ratio meeting the synthetic target under combined stress."],
        ["Kappa and d are two oracle quorums.", "Kappa is a hidden commitment; d is a comparable digest; two matching d values form quorum."],
        ["A Merkle proof proves a medical claim is true.", "It proves inclusion and integrity relative to an anchored root."],
        ["Slither proved the contracts secure.", "Static analysis and manual triage found no confirmed exploitable defect in scope; this is not an audit."],
        ["The system is deployed on public chains.", "The evaluated deployment is local Hardhat; Sepolia and Amoy remain uncompleted."],
    ],
    widths=[72 * mm, 102 * mm],
    font_size=6.7,
)
h2("Final one-sentence answer")
callout(
    "Say this:",
    "We built and locally evaluated a working, auditable insurance protocol in which realistic public data supports provider-risk prioritization, "
    "controlled mutations test claim-routing defenses, encrypted evidence remains off-chain, exact oracle/human authority controls decisions, "
    "and contract rules reserve and fund settlement - while the paper clearly states that this is not production fraud, clinical or actuarial certification.",
    "green",
)
h2("Key repository anchors")
bullets([
    "Dataset builder: backEnd/scripts/buildHybridDataset.js",
    "Schema and attacks: backEnd/services/hybridDatasetAdapterService.js",
    "Provider and routing evaluation: backEnd/scripts/evaluateHybridDataset.js",
    "Runtime features/model/policy: backEnd/services/featureEngineeringService.js, model-params.json, triage-policy.json",
    "Runtime scoring: backEnd/services/riskScoringService.js",
    "Oracle exact quorum: contracts/contracts/OracleCoordinator.sol",
    "Settlement and reserve arithmetic: contracts/contracts/PolicyEconomics.sol",
    "Evidence benchmark: backEnd/services/evidenceBenchmarkService.js",
    "Results: backEnd/evaluation-results/ and reference/CSDE/08_results.tex",
])


OUT.parent.mkdir(parents=True, exist_ok=True)
doc = GuideDocTemplate(str(OUT))
doc.build(story)
print(str(OUT))
