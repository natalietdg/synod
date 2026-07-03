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
import sys
import urllib.request
from math import ceil
import importlib.abc
import importlib.machinery
from unittest.mock import MagicMock


class _TFStub(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    """anl-agents' top-level import pulls one TensorFlow-based agent (team_renting).
    We don't run that agent; stub tensorflow so the rest of the league imports."""

    def find_spec(self, name, path=None, target=None):
        if name == "tensorflow" or name.startswith("tensorflow."):
            return importlib.machinery.ModuleSpec(name, self, is_package=True)
        return None

    def create_module(self, spec):
        m = MagicMock()
        m.__name__, m.__path__, m.__spec__ = spec.name, [], spec
        return m

    def exec_module(self, module):
        pass


sys.meta_path.insert(0, _TFStub())

from negmas import make_issue
from negmas.preferences import AffineUtilityFunction
from negmas.sao import SAOMechanism, SAONegotiator, ResponseType
from negmas.sao.negotiators import AspirationNegotiator, NaiveTitForTatNegotiator
from anl_agents.anl2024 import CARCAgent, Shochan, UOAgent

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
        # Each side speaks ~once per mechanism step, so their offer budget ≈ N_STEPS.
        self._deadline = N_STEPS
        # The council's real round-by-round reasoning, for the record shown on the site.
        self.trace: list[dict] = []

    def _record(self, state):
        offer = state.current_offer
        if offer is not None and state.current_proposer != self.id:
            # Record EVERY offer, repeats included — a repeated price is a held_firm
            # signal for the belief update, and the count drives the deadline rule.
            self._their_offers.append(int(offer[0]))

    def _decide(self):
        if not self._their_offers:
            return {"action": "hold", "ask": CEIL}
        return synod_decide(self._their_offers, self._deadline)

    def respond(self, state, source=None):
        self._record(state)
        d = self._decide()
        if self._their_offers:
            self.trace.append({
                "round": len(self._their_offers),
                "theirOffer": self._their_offers[-1],
                "councilAction": d["action"],
                "councilAsk": d.get("ask"),
                "why": d.get("why", ""),
            })
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
    # Seller (Synod) wants price high; buyer wants it low. Normalized to [0, 1] exactly
    # (Affine applies the bias; Linear silently ignores it in this negmas version).
    # reserved_value=0: walking pays nothing — matches Synod's floor semantics and gives
    # the ANL agents the reservation they expect to reason about.
    seller_u = AffineUtilityFunction(weights=[1 / span], bias=-FLOOR / span, issues=issues, reserved_value=0.0)
    buyer_u = AffineUtilityFunction(weights=[-1 / span], bias=CEIL / span, issues=issues, reserved_value=0.0)
    return m, seller_u, buyer_u


# (name, factory(buyer_u, seller_u), league) — league marks REAL ANAC/ANL competition
# entrants, verbatim from the anl-agents package (github.com/autoneg/anl-agents). Not ours.
# ANL 2024 protocol: each agent SEES the opponent's utility function (private_info);
# only reservation values are private — so we pass Synod's ufun as their opponent_ufun.
OPPONENTS = [
    ("Shochan", lambda u, su: Shochan(ufun=u, private_info={"opponent_ufun": su}), "ANL 2024 — competition winner"),
    ("UOAgent", lambda u, su: UOAgent(ufun=u, private_info={"opponent_ufun": su}), "ANL 2024"),
    ("CARCAgent", lambda u, su: CARCAgent(ufun=u, private_info={"opponent_ufun": su}), "ANL 2024"),
    ("AspirationNegotiator (boulware)", lambda u, su: AspirationNegotiator(ufun=u, aspiration_type="boulware"), None),
    ("AspirationNegotiator (linear)", lambda u, su: AspirationNegotiator(ufun=u, aspiration_type="linear"), None),
    ("AspirationNegotiator (conceder)", lambda u, su: AspirationNegotiator(ufun=u, aspiration_type="conceder"), None),
    ("NaiveTitForTatNegotiator", lambda u, su: NaiveTitForTatNegotiator(ufun=u), None),
]


R = 3  # sessions per opponent — some league agents are stochastic; report all runs


def one_session(factory):
    m, seller_u, buyer_u = make_session()
    synod = SynodNegotiator(name="synod", ufun=seller_u)
    opponent = factory(buyer_u, seller_u)
    m.add(opponent)  # buyer opens (mirrors Synod's native protocol: they move first)
    m.add(synod)
    m.run()
    price = int(m.agreement[0]) if m.agreement else None
    return price, buyer_u, synod.trace


def main():
    results = []
    for name, factory, league in OPPONENTS:
        prices, opp_utils, first_trace = [], [], None
        try:
            for run_i in range(R):
                price, buyer_u, trace = one_session(factory)
                prices.append(price)
                opp_utils.append(round(float(buyer_u((price,))), 3) if price is not None else 0.0)
                if run_i == 0:
                    first_trace = trace  # session 1's full reasoning, for the record
        except Exception as e:  # a league agent crashing is their bug — report, don't sink the run
            print(f"{name:36} → ERROR ({type(e).__name__}: {e})")
            continue
        deals = [p for p in prices if p is not None]
        mean_surplus = round(sum(p - FLOOR for p in deals) / R) if deals else 0
        row = {
            "opponent": name,
            "league": league,
            "runs": R,
            "deals": len(deals),
            "prices": prices,
            "synodSurplus": mean_surplus,  # mean over ALL runs (no-deals count as 0)
            "opponentUtility": round(sum(opp_utils) / R, 3),
            "trace": first_trace or [],  # session 1, round by round, with the council's why
        }
        results.append(row)
        tag = f"  [{league}]" if league else ""
        shown = ", ".join("walk" if p is None else f"${p:,}" for p in prices)
        print(f"{name:36} → {len(deals)}/{R} closed [{shown}]  mean surplus={mean_surplus:,}{tag}")

    out = {
        "protocol": "NegMAS SAOMechanism (alternating offers), n_steps=%d" % N_STEPS,
        "domain": "single issue: price 8,000–12,000; seller (Synod) utility rises with price",
        "opponents": "NegMAS library negotiators — not authored by this project",
        "results": results,
    }
    out["opponents"] = "NegMAS library negotiators + REAL ANL 2024 league entrants (anl-agents pkg) — none authored by this project"
    for path in ("bridge/results.json", "public/anl-results.json"):
        with open(path, "w") as f:
            json.dump(out, f, indent=2)
    print("\n✓ wrote bridge/results.json + public/anl-results.json")


if __name__ == "__main__":
    main()
