"""
Same mapping definitions as the Python data-finder example.
Used by generate.py to produce TypeScript finders.
"""
from model.m3 import Class, Property, String, Float, Package, Integer, Date, TaggedValue, DateTime
from model.mapping import Mapping, ProcessingDateMilestonesPropertyMapping, SingleBusinessDateMilestonePropertyMapping
from model.relational import Column, Table, Schema, Database
from model.relational_mapping import RelationalPropertyMapping, RelationalClassMapping, Join


def create_description(text: str) -> TaggedValue:
    return TaggedValue(TaggedValue.DOC, text)


def create_account_class() -> Class:
    p1 = Property('Id', 'id', Integer)
    p2 = Property('Name', 'name', String)
    return Class('Account', [p1, p2], Package('finance'),
                 tagged_values=[create_description('Trading Account used to buy and sell securities')])


def create_instrument_class() -> Class:
    p1 = Property('Symbol', 'symbol', String)
    p2 = Property('Price', 'price', Float)
    return Class('Instrument', [p1, p2], Package('finance'))


def create_trade_class(account: Class, instrument: Class) -> Class:
    p1 = Property('Symbol', 'symbol', String, [create_description('The symbol of the instrument traded')])
    p2 = Property('Price', 'price', Float, [create_description('The current price of the trade')])
    p3 = Property('Account', 'account', account, [create_description('The trading account')])
    p4 = Property('Valid From', 'validFrom', DateTime)
    p5 = Property('Valid To', 'validTo', DateTime)
    p6 = Property('Instrument', 'instrument', instrument)
    return Class('Trade', [p1, p2, p3, p4, p5, p6], Package('finance'))


def create_contractual_position_class(instrument: Class) -> Class:
    p1 = Property('Business Date', 'businessDate', Date)
    p2 = Property('Quantity', 'quantity', Float)
    p3 = Property('Counterparty', 'counterparty', Integer)
    p4 = Property('Instrument', 'instrument', instrument)
    p5 = Property('Npv', 'npv', Float)
    return Class('ContractualPosition', [p1, p2, p3, p4, p5], Package('finance'))


def create_mappings_normalized() -> Mapping:
    repo = Database('finance_db', 'duckdb://test.db')
    ref_data = Schema('ref_data', repo)
    trading = Schema('trading', repo)

    account_c = create_account_class()
    ac1 = Column('ID', 'INT')
    ac2 = Column('ACCT_NAME', 'VARCHAR')
    account_t = Table('account_master', [ac1, ac2], ref_data)

    instrument_c = create_instrument_class()
    ic1 = Column('SYM', 'VARCHAR')
    ic2 = Column('PRICE', 'DOUBLE')
    ic3 = Column('START_AT', 'DATE_TIME')
    ic4 = Column('END_AT', 'DATE_TIME')
    instrument_t = Table('price', [ic1, ic2, ic3, ic4], ref_data)

    c_position_c = create_contractual_position_class(instrument_c)
    p1 = Column('DATE', 'DATE')
    p2 = Column('INSTRUMENT', 'VARCHAR')
    p3 = Column('CPTY_ID', 'INT')
    p4 = Column('QUANTITY', 'DOUBLE')
    p5 = Column('NPV', 'DOUBLE')
    pos_t = Table('contractualposition', [p1, p2, p3, p4, p5], trading)

    trade_c = create_trade_class(account_c, instrument_c)
    c1 = Column('id', 'INT')
    c2 = Column('account_id', 'INT')
    c3 = Column('sym', 'VARCHAR')
    c4 = Column('price', 'DOUBLE')
    c5 = Column('start_at', 'TIMESTAMP')
    c6 = Column('end_at', 'TIMESTAMP')
    trade_t = Table('trades', [c1, c2, c3, c4, c5, c6], trading)

    pm1 = RelationalPropertyMapping(trade_c.property('symbol'), c3)
    pm2 = RelationalPropertyMapping(trade_c.property('price'), c4)
    pm3 = RelationalPropertyMapping(trade_c.property('account'), Join(c2, ac1))
    pm4 = RelationalPropertyMapping(trade_c.property('validFrom'), c5)
    pm5 = RelationalPropertyMapping(trade_c.property('validTo'), c6)
    pm6 = RelationalPropertyMapping(trade_c.property('instrument'), Join(c3, ic1))
    mpm = ProcessingDateMilestonesPropertyMapping(pm4, pm5)
    rm_t = RelationalClassMapping(trade_c, [pm1, pm2, pm3, pm4, pm5, pm6], mpm)

    a_pm1 = RelationalPropertyMapping(account_c.property('id'), ac1)
    a_pm2 = RelationalPropertyMapping(account_c.property('name'), ac2)
    rm_a = RelationalClassMapping(account_c, [a_pm1, a_pm2])

    i_pm1 = RelationalPropertyMapping(instrument_c.property('symbol'), ic1)
    i_pm2 = RelationalPropertyMapping(instrument_c.property('price'), ic2)
    i_pm3 = RelationalPropertyMapping(trade_c.property('validFrom'), ic3)
    i_pm4 = RelationalPropertyMapping(trade_c.property('validTo'), ic4)
    i_mpm = ProcessingDateMilestonesPropertyMapping(i_pm3, i_pm4)
    rm_i = RelationalClassMapping(instrument_c, [i_pm1, i_pm2, i_pm3, i_pm4], i_mpm)

    cpm1 = RelationalPropertyMapping(c_position_c.property('businessDate'), p1)
    cpm2 = RelationalPropertyMapping(c_position_c.property('quantity'), p4)
    cpm3 = RelationalPropertyMapping(c_position_c.property('counterparty'), p3)
    cpm4 = RelationalPropertyMapping(c_position_c.property('instrument'), Join(p2, ic1))
    cpm5 = RelationalPropertyMapping(c_position_c.property('npv'), p5)
    cpm_t = SingleBusinessDateMilestonePropertyMapping(cpm1)
    rm_cp = RelationalClassMapping(c_position_c, [cpm1, cpm2, cpm3, cpm4, cpm5], cpm_t)

    return Mapping('Test Mapping 1', [rm_t, rm_a, rm_i, rm_cp])
