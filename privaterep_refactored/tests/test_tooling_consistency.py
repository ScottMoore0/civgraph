import pytest

pd = pytest.importorskip("pandas")
flask = pytest.importorskip("flask")

from ni_votes.web import routes
from ni_votes.web.data_access import (
    CFG_ER_DF,
    CFG_TR_DF,
    CFG_CONSTS,
    CFG_CANDIDATES,
    CFG_IMPORT_KEYS,
    CFG_ELECTED_BODIES,
    CFG_ELECTION_TYPES,
    CFG_PARTIES,
)


class DummyApp:
    def __init__(self):
        self.config = {
            CFG_CONSTS: [],
            CFG_CANDIDATES: [],
            CFG_IMPORT_KEYS: [],
            CFG_ELECTED_BODIES: [],
            CFG_ELECTION_TYPES: [],
            CFG_PARTIES: [],
        }


def _make_candidate_rows(constituency: str, party_votes: dict, valid: int, date: str = "2022-05-05"):
    rows = [
        {
            "DateStr": date,
            "Constituency": constituency,
            "ElectedBody": "Northern Ireland Assembly",
            "ResultType": "Total valid votes",
            "Votes": valid,
        }
    ]
    pid = 100
    for party, entries in party_votes.items():
        for name, fpv in entries:
            rows.append(
                {
                    "DateStr": date,
                    "Constituency": constituency,
                    "ElectedBody": "Northern Ireland Assembly",
                    "ResultType": "Candidate",
                    "PersonID": pid,
                    "Name": name,
                    "Party": party,
                    "First Prefs": fpv,
                }
            )
            pid += 1
    return rows


def test_aggregate_niwide_selects_best_representative():
    data = []
    data.extend(
        _make_candidate_rows(
            "North",
            {
                "Alliance": [("Alice North", 5000), ("Alex North", 2000)],
                "DUP": [("Dylan North", 2500)],
            },
            valid=10000,
        )
    )
    data.extend(
        _make_candidate_rows(
            "South",
            {
                "Alliance": [("Sally South", 3000)],
                "DUP": [("Donna South", 6000)],
            },
            valid=6000,
        )
    )

    df = pd.DataFrame(data)
    result = routes._aggregate_niwide(
        df,
        {"date": "2022-05-05", "elected_body": "Northern Ireland Assembly", "constituency": ""},
    )

    candidates = {c["party"]: c for c in result["candidates"]}
    assert candidates["Alliance"]["name"] == "Alice North"
    assert candidates["Alliance"]["first_pref"] == pytest.approx(5000 + 2000 + 3000)
    assert candidates["DUP"]["name"] in {"Dylan North", "Donna South"}


def test_transfer_events_df_merges_metadata(monkeypatch):
    app = DummyApp()

    er_df = pd.DataFrame(
        [
            {
                "DateStr": "2022-05-05",
                "Constituency": "Test",
                "ElectedBody": "Northern Ireland Assembly",
                "ResultType": "Candidate",
                "PersonID": 101,
                "Name": "Naomi Long",
                "Party": "Alliance",
                "Event": "Assembly Election",
                "EventType": "DevolvedElection",
            },
            {
                "DateStr": "2022-05-05",
                "Constituency": "Test",
                "ElectedBody": "Northern Ireland Assembly",
                "ResultType": "Candidate",
                "PersonID": 202,
                "Name": "Michelle O'Neill",
                "Party": "Sinn Féin",
                "Event": "Assembly Election",
                "EventType": "DevolvedElection",
            },
        ]
    )
    tr_df = pd.DataFrame({"dummy": [1]})
    app.config[CFG_ER_DF] = er_df
    app.config[CFG_TR_DF] = tr_df

    pairs_df = pd.DataFrame(
        [
            {
                "date": "2022-05-05",
                "constituency": "Test",
                "body": "Northern Ireland Assembly",
                "etype": "DevolvedElection",
                "donor_pid": 101,
                "donor_party": "Alliance",
                "donor_party_display": "Alliance",
                "recipient_pid": 202,
                "recipient_party": "Sinn Féin",
                "recipient_party_display": "Sinn Féin",
                "y_share": 0.25,
                "weight": 1000.0,
                "count": 3,
                "is_surplus": False,
                "is_elimination": True,
            }
        ]
    )

    monkeypatch.setattr(routes, "_build_pairs_stateful", lambda er, tr: (pairs_df.copy(), None))

    df_out = routes._transfer_events_df(app)
    assert not df_out.empty
    row = df_out.iloc[0]
    assert row["source_party_display"] == "Alliance"
    assert row["source_id"] == 101
    assert row["dest_id"] == 202
    assert row["transfer_votes"] == pytest.approx(250.0)
    assert app.config.get("TRANSFER_EVENTS_DF") is not None


def test_cross_validation_route_uses_builder_and_cv(monkeypatch):
    app = flask.Flask(__name__)
    routes.init_routes(app)

    app.config[CFG_ER_DF] = pd.DataFrame({"ResultType": []})
    app.config[CFG_TR_DF] = pd.DataFrame({"dummy": [1]})
    app.config["ML_TABLES"] = {}

    train_df = pd.DataFrame(
        {
            "DestParty": ["A", "B"],
            "SourceParty": ["X", "Y"],
            "Weight": [1.0, 1.0],
        }
    )

    captured = {}

    def fake_builder(tr_df, er_df):
        captured["builder_called"] = True
        return train_df

    def fake_cv(df):
        captured["cv_called"] = df.copy()
        return {"mean_log_loss": 0.1234, "mean_accuracy": 0.5678}

    monkeypatch.setattr(routes, "build_training_from_transfers_with_context", fake_builder)
    monkeypatch.setattr(routes, "cross_validate_transfers", fake_cv)

    client = app.test_client()
    resp = client.get("/transfers_cv")
    assert resp.status_code == 200
    body = resp.data.decode("utf-8")
    assert "0.1234" in body and "0.5678" in body
    assert captured.get("builder_called") is True
    assert not captured.get("cv_called").empty
