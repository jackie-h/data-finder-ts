import json
import os
import sys

import datafinder_examples
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import export_json  # noqa: E402  (er-diagram/export_json.py, a script rather than an installed package)

# the markdown e2e files shipped in the installed data-finder package
EXAMPLES = os.path.dirname(os.path.abspath(datafinder_examples.__file__))


@pytest.fixture(scope="module")
def finance():
    return export_json.export_mapping(os.path.join(EXAMPLES, "finance_mapping.md"), "finance_mapping.md", EXAMPLES)


def _model(name):
    return export_json.export_model(os.path.join(EXAMPLES, name), name)


def test_model_classes_properties_and_docs():
    package = _model("finance.md")["packages"][0]
    assert package["name"] == "finance.reference_data"
    account = next(c for c in package["classes"] if c["name"] == "Account")
    assert account["description"] == "Trading account used to buy and sell securities"
    # own properties only: the association-derived navigation property is not a property of the class
    assert [p["id"] for p in account["properties"]] == ["id", "name"]
    assert account["properties"][0] == {
        "name": "Id", "id": "id", "type": "Integer", "multiplicity": "1", "key": True, "description": "",
    }
    branch = next(c for c in package["classes"] if c["name"] == "Branch")
    assert next(p for p in branch["properties"] if p["id"] == "city")["multiplicity"] == "0..1"


def test_model_association():
    association = _model("finance.md")["packages"][0]["associations"][0]
    assert association["name"] == "AccountBranch"
    assert (association["source"], association["sourceMultiplicity"]) == ("Account", "*")
    assert (association["target"], association["targetMultiplicity"]) == ("Branch", "0..1")
    assert association["targetPropertyName"] == "Branch"


def test_inheritance_is_exported():
    classes = {c["name"]: c for c in _model("orgchart_inheritance.md")["packages"][0]["classes"]}
    assert classes["Employee"]["superclasses"] == ["Person", "Contactable"]
    assert classes["Person"]["superclasses"] == []


def test_mapping_tables_columns_and_classes(finance):
    assert finance["title"] == "Finance Mapping"
    assert finance["models"] == ["finance.md", "finance_trade.md"]
    assert finance["dataStore"] == {"name": "finance_db", "type": "Database"}
    tables = {(s["name"], t["name"]): t for s in finance["schemas"] for t in s["tables"]}
    assert set(tables) == {("ref_data", "account_master"), ("ref_data", "branch"), ("ref_data", "price"),
                           ("trading", "trades"), ("trading", "contractualposition")}
    account = tables[("ref_data", "account_master")]
    assert account["class"] == "Account"
    columns = {c["name"]: c for c in account["columns"]}
    assert columns["ID"] == {"name": "ID", "type": "INT", "primaryKey": True, "nullable": False, "property": "id"}
    assert columns["ACCT_NAME"]["property"] == "name"
    assert columns["in_z"]["property"] == "validFrom"                       # milestoning column
    assert columns["BRANCH_ID"]["property"] is None                         # a foreign key: mapped through the association


def test_mapping_associations_carry_columns_and_multiplicities(finance):
    by_name = {a["name"]: a for a in finance["associations"]}
    assert by_name["AccountBranch"]["rows"] == [{
        "sourceSchema": "ref_data", "sourceTable": "account_master", "sourceColumn": "BRANCH_ID",
        "targetSchema": "ref_data", "targetTable": "branch", "targetColumn": "ID",
    }]
    assert (by_name["AccountBranch"]["sourceMultiplicity"], by_name["AccountBranch"]["targetMultiplicity"]) == ("*", "0..1")
    trade_account = by_name["TradeAccount"]["rows"][0]                      # a foreign key across schemas
    assert (trade_account["sourceSchema"], trade_account["targetSchema"]) == ("trading", "ref_data")


def test_dir_can_name_an_installed_package(tmp_path):
    config = tmp_path / "config.json"
    config.write_text(json.dumps({"dir": "python:datafinder_examples", "models": ["diamond_model.md"]}))
    assert export_json.export(str(config))["models"][0]["file"] == "diamond_model.md"
    assert export_json.resolve_dir(str(config), "python:datafinder_examples") == EXAMPLES


def test_export_from_config_includes_models_the_mappings_reference(tmp_path):
    config = tmp_path / "config.json"
    config.write_text(json.dumps({
        "dir": os.path.relpath(EXAMPLES, tmp_path), "models": ["positions_model.md"],
        "mappings": ["finance_mapping.md", {"path": "positions_mapping.md"}],
    }))
    data = export_json.export(str(config))
    assert [m["file"] for m in data["models"]] == ["positions_model.md", "finance.md", "finance_trade.md"]
    assert [m["file"] for m in data["mappings"]] == ["finance_mapping.md", "positions_mapping.md"]


def test_cli_writes_json(tmp_path):
    config = tmp_path / "config.json"
    config.write_text(json.dumps({"dir": os.path.relpath(EXAMPLES, tmp_path), "models": ["diamond_model.md"]}))
    out = tmp_path / "nested" / "data.json"
    export_json.main(["--config", str(config), "--out", str(out)])
    assert json.loads(out.read_text())["models"][0]["file"] == "diamond_model.md"
