/**
 * A value that depends on a condition, written as in polars:
 * `when(f.age().gt(30)).then('senior').otherwise('junior')`.
 */
import { Attribute } from './attribute';
import { constant } from './expressions';
import {
  CaseOperation,
  ComparisonOperation,
  ExistsOperation,
  InOperation,
  IsNotNullOperation,
  IsNullOperation,
  LogicalOperation,
  NotExistsOperation,
  NotInOperation,
  Operation,
  RelationalOperationElement,
} from '../model/relational';

const CONDITIONS = [
  ComparisonOperation, LogicalOperation, IsNullOperation, IsNotNullOperation,
  InOperation, NotInOperation, ExistsOperation, NotExistsOperation,
];

/** What a branch can be: a column or expression as it is, a plain value as a constant. */
export type Branch = Attribute | RelationalOperationElement | boolean | number | string | Date;

/**
 * Something that is true or false for a row, which a `when` can test: a comparison, a null check, a membership
 * test, `exists`, or `and` / `or` of those. Checked when `when` is called.
 */
export type Condition = Operation | ExistsOperation | NotExistsOperation;

type Case = [Condition, RelationalOperationElement];

function value(branch: Branch): RelationalOperationElement {
  if (branch instanceof Attribute) return branch.cwj();
  if (branch instanceof RelationalOperationElement) return branch;
  try {
    return constant(branch);
  } catch {
    throw new TypeError(`A branch is a column, an expression or a value, not ${branch === null ? 'null' : typeof branch}`);
  }
}

function checked(condition: unknown): Condition {
  if (!CONDITIONS.some(c => condition instanceof c)) {
    throw new TypeError('The condition is a comparison, a null check, a membership test, exists, or and/or of those');
  }
  return condition as Condition;
}

/** The cases in order as a conditional: each later case is what the one before falls back to. */
function chain(cases: Case[], fallback?: RelationalOperationElement): CaseOperation {
  const [[condition, then], ...rest] = cases;
  return new CaseOperation(condition, then, rest.length > 0 ? chain(rest, fallback) : fallback);
}

/**
 * `when(condition).then(value)`: a column on its own (missing where the condition does not hold), or continued
 * with another `when` or closed with `otherwise`.
 */
export class Then extends CaseOperation {
  constructor(private readonly cases: Case[]) {
    const first = chain(cases);
    super(first.condition, first.then, first.fallback);
  }

  /** Another case, tried when the ones before it do not hold. */
  when(condition: Condition): When {
    return new When(checked(condition), this.cases);
  }

  /** The value when none of the cases hold. */
  otherwise(branch: Branch): CaseOperation {
    return chain(this.cases, value(branch));
  }
}

export class When {
  constructor(private readonly condition: Condition, private readonly earlier: Case[] = []) {}

  /** The value where the condition holds. A value is a column, an expression or a plain value. */
  then(branch: Branch): Then {
    return new Then([...this.earlier, [this.condition, value(branch)]]);
  }
}

/**
 * Start a conditional: `when(f.category().eq('Technology')).then('tech').otherwise('other')`.
 *
 * Further cases follow with `.when(...).then(...)`; with no `otherwise` the value is missing (NULL). A condition
 * that is NULL for a row (a comparison with a missing value) is not true, so that row takes the next case.
 */
export function when(condition: Condition): When {
  return new When(checked(condition));
}
