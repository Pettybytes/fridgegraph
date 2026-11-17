"""Retrieval/citation contracts. Citation membership is not factual entailment."""
from metrics import number


def identifiers(value, name, nonempty=False):
    if not isinstance(value, list) or any(not isinstance(v, str) or not v for v in value):
        raise ValueError(f'{name} must be a list of document IDs')
    if len(value) != len(set(value)) or (nonempty and not value):
        raise ValueError(f'{name} must contain unique IDs' + (' and be nonempty' if nonempty else ''))
    return value


def evaluate_retrieval(case):
    relevant = set(identifiers(case['relevant_ids'], 'relevant_ids', nonempty=True))
    retrieved = identifiers(case['retrieved_ids'], 'retrieved_ids')
    citations = identifiers(case.get('citation_ids', []), 'citation_ids')
    k = case['k']
    if not isinstance(k, int) or isinstance(k, bool) or k < 1:
        raise ValueError('k must be a positive integer')
    top = retrieved[:k]
    hits = len(relevant.intersection(top))
    recall, precision = hits / len(relevant), hits / k
    mrr = next((1 / rank for rank, doc in enumerate(top, 1) if doc in relevant), 0.0)
    threshold = number(case['min_recall'], 'min_recall')
    if threshold > 1:
        raise ValueError('min_recall must be <= 1')
    citations_valid = bool(citations) and set(citations).issubset(set(top) & relevant)
    if not case.get('require_citations', True) and not citations:
        citations_valid = True
    return {'recall_at_k': recall, 'precision_at_k': precision, 'mrr_at_k': mrr,
            'citations_valid': citations_valid, 'passed': recall >= threshold and citations_valid}
