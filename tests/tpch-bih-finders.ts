/**
 * The finders the TPC-BiH specs query, which a query reaches as `q.order`, `q.customer`, `q.partsupp`, `q.lineitem` and `q.supplier`
 * (the Python project's `SimpleNamespace` of finders). The others are imported so that every finder is registered.
 */
import { CustomerFinder } from './generated_examples/tpch_bih/CustomerFinder';
import { LineItemFinder } from './generated_examples/tpch_bih/LineItemFinder';
import { OrderFinder } from './generated_examples/tpch_bih/OrderFinder';
import { PartSuppFinder } from './generated_examples/tpch_bih/PartSuppFinder';
import './generated_examples/tpch_bih/NationFinder';
import './generated_examples/tpch_bih/PartFinder';
import './generated_examples/tpch_bih/RegionFinder';
import { SupplierFinder } from './generated_examples/tpch_bih/SupplierFinder';

export interface TpchBihFinders {
  order: OrderFinder;
  customer: CustomerFinder;
  partsupp: PartSuppFinder;
  lineitem: LineItemFinder;
  supplier: SupplierFinder;
}

export function tpchBihFinders(): TpchBihFinders {
  return { order: new OrderFinder(), customer: new CustomerFinder(), partsupp: new PartSuppFinder(), lineitem: new LineItemFinder(), supplier: new SupplierFinder() };
}
