"""
Synod × NegMAS — the council inside a real NegMAS SAOMechanism, against real
negotiation-literature agents (external-validity rung 2, after the Faratin baselines).

  NegMAS SAOMechanism
    ├── SynodNegotiator (seller) ──HTTP──▶ Synod /api/bridge/decide
    │      the council replays its canonical loop (belief → five lenses → chair →
    │      gate → ask evolution) over the opponent's offer history, deterministically
    └── a NegMAS agent (buyer): AspirationNegotiator (boulware / linear / conceder
        curves) or NaiveTitForTatNegotiator — code from the NegMAS library, not ours

Single-issue price domain, 8,000–12,000 (Synod's native space). Seller utility rises
with price, buyer utility falls. Run:  bridge/.venv/bin/python bridge/synod_negmas.py
(needs the Synod server on :4173). Writes bridge/results.json.
"""

import json
import urllib.request
from math import ceil

from negmas import make_issue
from negmas.preferences import LinearUtilityFunction
from negmas.sao import SAOMechanism, SAONegotiator, ResponseType
from negmas.sao.negotiators import AspirationNegotiator, NaiveTitForTatNegotiator

SYNOD = "http://localhost:4173/api/bridge/decide"
FLOOR, CEIL = 8_000, 12_000
N_STEPS = 8  # SAO rounds; each side speaks ~4 times — Synod's native horizon


def synod_decide(offers, deadline):
    body = json.dumps({"offers": offers, "deadline": deadline}).encode()
    req = urllib.request.Request(SYNOD, data=body, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


class SynodNegotiator(SAONegotiator):
    """The council as a NegMAS negotiator. All judgment happens on the TS side; this
    class only ferries the opponent's observed offers across and maps the answer back."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._their_offers: list[int] = []
        self._deadline = max(2, ceil(N_STEPS / 2))

    def _record(self, state):
        offer = state.current_offer
        if offer is not None:
            price = int(offer[0])
            if not self._their_offers or self._their_offers[-1] != price:
                self._their_offers.append(price)

    def _decide(self):
        if not self._their_offers:
            return {"action": "hold", "ask": CEIL}
        return synod_decide(self._their_offers, self._deadline)

    def respond(self, state, source=None):
        self._record(state)
        d = self._decide()
        if d["action"] == "accept":
            return ResponseType.ACCEPT_OFFER
        if d["action"] == "walk":
            return ResponseType.END_NEGOTIATION
        return ResponseType.REJECT_OFFER

    def propose(self, state, dest=None):
        d = self._decide()
        ask = int(min(CEIL, max(FLOOR, d.get("ask", CEIL))))
        return (ask,)


def make_session():
    issues = [make_issue((FLOOR, CEIL), "price")]
    m = SAOMechanism(issues=issues, n_steps=N_STEPS)
    span = CEIL - FLOOR
    # Seller (Synod) wants price high; buyer wants it low. Normalized to [0, 1].
    seller_u = LinearUtilityFunction(weights=[1 / span], bias=-FLOOR / span, issues=issues)
    buyer_u = LinearUtilityFunction(weights=[-1 / span], bias=CEIL / span, issues=issues)
    return m, seller_u, buyer_u


OPPONENTS = {
    "AspirationNegotiator (boulware)": lambda u: AspirationNegotiator(ufun=u, aspiration_type="boulware"),
    "AspirationNegotiator (linear)": lambda u: AspirationNegotiator(ufun=u, aspiration_type="linear"),
    "AspirationNegotiator (conceder)": lambda u: AspirationNegotiator(ufun=u, aspiration_type="conceder"),
    "NaiveTitForTatNegotiator": lambda u: NaiveTitForTatNegotiator(ufun=u),
}


def main():
    results = []
    for name, factory in OPPONENTS.items():
        m, seller_u, buyer_u = make_session()
        synod = SynodNegotiator(name="synod", ufun=seller_u)
        opponent = factory(buyer_u)
        m.add(opponent)  # buyer opens (mirrors Synod's native protocol: they move first)
        m.add(synod)
        m.run()
        agreement = m.agreement
        price = int(agreement[0]) if agreement else None
        surplus = (price - FLOOR) if price is not None else 0
        row = {
            "opponent": name,
            "agreement": bool(agreement),
            "price": price,
            "synodSurplus": surplus,
            "synodUtility": round(float(seller_u(agreement)), 3) if agreement else 0.0,
            "opponentUtility": round(float(buyer_u(agreement)), 3) if agreement else 0.0,
            "steps": m.current_step,
        }
        results.append(row)
        print(f"{name:36} → {'DEAL @ $' + format(price, ',') if agreement else 'NO DEAL'}"
              f"  synod surplus={surplus:,}  (steps={m.current_step})")

    out = {
        "protocol": "NegMAS SAOMechanism (alternating offers), n_steps=%d" % N_STEPS,
        "domain": "single issue: price 8,000–12,000; seller (Synod) utility rises with price",
        "opponents": "NegMAS library negotiators — not authored by this project",
        "results": results,
    }
    with open("bridge/results.json", "w") as f:
        json.dump(out, f, indent=2)
    print("\n✓ wrote bridge/results.json")


if __name__ == "__main__":
    main()
