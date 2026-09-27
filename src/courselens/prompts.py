"""Prompt templates for CourseLens.

All model-facing text lives here so the product's core guardrail — *guide the
student, never do the work for them* — is defined in exactly one place and
applied consistently across every workflow.

Every analysis prompt asks the model to return strict JSON. The shapes match
the data model documented in ARCHITECTURE.md and validated in results.py.
"""

from __future__ import annotations

# The document types CourseLens can classify. Kept as a tuple so it can be
# reused for validation and interpolated into the classification prompt.
DOCUMENT_TYPES: tuple[str, ...] = (
    "assignment",
    "lecture_notes",
    "reading",
    "syllabus",
    "rubric",
    "dataset",
    "other",
)

# Shared system instruction. This is the anti-cheating guardrail and is
# attached to every generative call.
GUARDRAIL_SYSTEM = (
    "You are CourseLens, an AI study assistant that helps students understand "
    "their course materials and plan their own work. Your role is to guide, "
    "explain, and organize — never to complete graded work for the student. "
    "You must NOT write essays, full problem solutions, finished code, or any "
    "content the student could submit as their own. Instead, break work into "
    "steps, explain concepts in plain language, and point to what the student "
    "needs to learn and do. Always respond with valid JSON only, with no "
    "surrounding prose, markdown code fences, or commentary."
)


def classification_prompt(text: str) -> str:
    """Prompt that asks the model to classify the document type."""
    allowed = ", ".join(DOCUMENT_TYPES)
    return (
        "Classify the following course material into exactly one type.\n"
        f"Allowed types: {allowed}.\n\n"
        "Return JSON of the form:\n"
        '{"type": "<one of the allowed types>", "confidence": <number 0-1>}\n\n'
        "Guidance:\n"
        "- 'assignment': tasks the student must complete and submit (homework, "
        "projects, problem sets, essays to write).\n"
        "- 'lecture_notes': notes/slides conveying taught material.\n"
        "- 'reading': article, chapter, or text meant to be read.\n"
        "- 'syllabus': course outline, schedule, policies.\n"
        "- 'rubric': grading criteria.\n"
        "- 'dataset': tabular or raw data.\n"
        "- 'other': none of the above.\n\n"
        "Course material:\n"
        '"""\n'
        f"{text}\n"
        '"""'
    )


def assignment_prompt(text: str) -> str:
    """Prompt for the assignment workflow.

    Guides the student through the assignment without completing it.
    """
    return (
        "The student uploaded an ASSIGNMENT. Help them understand and plan it "
        "WITHOUT doing the work for them.\n\n"
        "Return JSON with exactly these keys:\n"
        "{\n"
        '  "explanation": "plain-language explanation of what the assignment '
        'is asking",\n'
        '  "requirements": ["specific requirements the work must meet"],\n'
        '  "deliverables": ["what the student must produce/submit"],\n'
        '  "deadlines": ["any dates or time constraints found; empty if none"],\n'
        '  "constraints": ["important constraints, e.g. length, format, tools, '
        'rules"],\n'
        '  "actionPlan": [{"step": 1, "title": "short step title", "detail": '
        '"what to do in this step — describe the action, do NOT do it for '
        'them"}],\n'
        '  "concepts": [{"name": "concept name", "whyItMatters": "why the '
        'student needs to understand this to complete the assignment"}]\n'
        "}\n\n"
        "Rules:\n"
        "- Do NOT write the actual answer, essay, code, or solution.\n"
        "- The action plan describes steps the student should take themselves.\n"
        "- If a field has no content, use an empty list.\n\n"
        "Assignment:\n"
        '"""\n'
        f"{text}\n"
        '"""'
    )


def lecture_prompt(text: str, doc_type: str) -> str:
    """Prompt for the lecture-notes / reading workflow."""
    return (
        f"The student uploaded {doc_type.replace('_', ' ')}. Help them study "
        "it.\n\n"
        "Return JSON with exactly these keys:\n"
        "{\n"
        '  "summary": "a concise summary of the material",\n'
        '  "keyConcepts": [{"name": "concept", "explanation": "plain-language '
        'explanation"}],\n'
        '  "difficultConcepts": [{"name": "concept", "explanation": "plain '
        'explanation of a concept students often find hard"}],\n'
        '  "quiz": [{"question": "study question", "answer": "concise model '
        'answer"}]\n'
        "}\n\n"
        "Rules:\n"
        "- Provide exactly 5 quiz questions.\n"
        "- Keep explanations clear and beginner-friendly.\n"
        "- If a field has no content, use an empty list.\n\n"
        "Material:\n"
        '"""\n'
        f"{text}\n"
        '"""'
    )


def explain_prompt(context: str, target: str) -> str:
    """Prompt for the on-demand 'explain further' interaction."""
    return (
        "The student wants a deeper, plain-language explanation of one specific "
        "item from their course material. Explain it so they understand it "
        "themselves — do NOT complete any graded work.\n\n"
        "Return JSON of the form:\n"
        '{"explanation": "a clear, plain-language explanation of the target"}\n\n'
        f"Item to explain: {target}\n\n"
        "Surrounding context:\n"
        '"""\n'
        f"{context}\n"
        '"""'
    )
