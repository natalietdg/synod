"""
Extract a slim, ground-truth view of the CraigslistBargain corpus (He et al. 2018,
Stanford NLP; 6.6k REAL human-human price negotiations collected on MTurk over real
Craigslist listings). Source: the HF auto-converted parquet of stanfordnlp/craigslist_bargains.

Per dialogue we keep only what the transcript rung needs: the listing price, both
targets, the BUYER's price offers in order, and the human outcome. Run once; the slim
JSON is committed for reproducibility (the parquet is not).
"""
import glob, json, sys
import pandas as pd

SRC = sys.argv[1] if len(sys.argv) > 1 else "."
rows = []
for path in sorted(glob.glob(f"{SRC}/*.parquet")):
    df = pd.read_parquet(path)
    for _, r in df.iterrows():
        roles = list(r["agent_info"]["Role"])
        targets = list(r["agent_info"]["Target"])
        listing = float(r["items"]["Price"][0])
        if listing <= 0 or "buyer" not in roles or "seller" not in roles:
            continue
        buyer_id = roles.index("buyer")
        turns = list(r["agent_turn"])
        intents = list(r["dialogue_acts"]["intent"])
        prices = list(r["dialogue_acts"]["price"])
        buyer_offers, outcome, deal_price, final_actor = [], "nodeal", None, "none"
        last_price = None
        for i, intent in enumerate(intents):
            actor = int(turns[i]) if i < len(turns) else None
            p = float(prices[i]) if i < len(prices) else -1.0
            if p and p > 0:
                last_price = p
                if actor == buyer_id:
                    buyer_offers.append(round(p, 2))
            if intent == "accept":
                outcome, deal_price = "deal", last_price
                final_actor = "seller-accept" if actor != buyer_id else "buyer-accept"
                break
            if intent in ("reject", "quit"):
                outcome = "nodeal"
                break
        if not buyer_offers:
            continue
        rows.append({
            "category": str(r["items"]["Category"][0]),
            "listing": round(listing, 2),
            "buyerTarget": round(float(targets[buyer_id]), 2),
            "sellerTarget": round(float(targets[1 - buyer_id]), 2),
            "buyerOffers": buyer_offers,
            "outcome": outcome,
            "dealPrice": round(deal_price, 2) if deal_price else None,
            "finalActor": final_actor,
        })

out = {
    "source": "CraigslistBargain (He, Chen, Balachandran, Liang 2018) — stanfordnlp/craigslist_bargains",
    "note": "real human-human negotiations over real Craigslist listings (MTurk workers with assigned private targets)",
    "dialogues": rows,
}
with open("data/craigslist-slim.json", "w") as f:
    json.dump(out, f)
print(f"kept {len(rows)} dialogues with >=1 buyer price offer")
print(f"  deals: {sum(1 for x in rows if x['outcome']=='deal')} "
      f"(seller-accept: {sum(1 for x in rows if x['finalActor']=='seller-accept')}, "
      f"buyer-accept: {sum(1 for x in rows if x['finalActor']=='buyer-accept')}) · "
      f"no-deal: {sum(1 for x in rows if x['outcome']=='nodeal')}")
