import { Attribute } from './attribute';
import { QueryRunner, QueryTarget, Row } from './runner';
import {
  RelationalOperationElement,
  SortOperation,
} from '../model/relational';
import {
  GraphQLQuery,
  GraphQLProcessingMilestone,
  GraphQLBusinessDateMilestone,
  GraphQLBiTemporalMilestone,
} from '../model/graphql_mapping';

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function buildTemporalArgs(
  businessDate: Date | null,
  processingDatetime: Date | null,
  milestone: GraphQLQuery['milestone'],
): string[] {
  if (!milestone) return [];
  const args: string[] = [];
  if (milestone instanceof GraphQLBiTemporalMilestone) {
    if (businessDate) args.push(`${milestone.businessDateArgument}: "${formatDate(businessDate)}"`);
    if (processingDatetime) args.push(`${milestone.processingArgument}: "${processingDatetime.toISOString()}"`);
  } else if (milestone instanceof GraphQLBusinessDateMilestone) {
    if (businessDate) args.push(`${milestone.argumentName}: "${formatDate(businessDate)}"`);
  } else if (milestone instanceof GraphQLProcessingMilestone) {
    if (processingDatetime) args.push(`${milestone.argumentName}: "${processingDatetime.toISOString()}"`);
  }
  return args;
}

export class GraphQLConnect implements QueryRunner {
  async select(
    businessDate: Date | null,
    processingDatetime: Date | null,
    columns: (Attribute | RelationalOperationElement)[],
    table: QueryTarget,
    _op: RelationalOperationElement,
    _orderBy?: SortOperation[],
    _groupBy?: Attribute[],
    _limit?: number,
  ): Promise<Row[]> {
    const gqlQuery = table as GraphQLQuery;
    const fieldNames = (columns as Attribute[]).map(col => col.column().name);
    const fieldsStr = fieldNames.join(' ');

    const argParts = buildTemporalArgs(businessDate, processingDatetime, gqlQuery.milestone);
    const args = argParts.length > 0 ? `(${argParts.join(', ')})` : '';
    const queryStr = `{ ${gqlQuery.name}${args} { ${fieldsStr} } }`;

    const response = await fetch(gqlQuery.endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: queryStr }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as { data: Record<string, Record<string, unknown>[]> };
    const entities = result.data[gqlQuery.name] ?? [];
    return entities.map(row => fieldNames.map(f => row[f]));
  }
}
