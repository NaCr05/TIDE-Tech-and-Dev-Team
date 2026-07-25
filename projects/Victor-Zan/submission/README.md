# CSC3100 Assignment 1 Simulation Dataset

This dataset supports the Mattermost grading MVP workflow:

`create assignment -> upload submission -> multi-agent grading -> return evidence-based result`

## Key files

- `assignment/CSC3100_Assignment1.pdf`: teacher-published assignment brief
- `rubric/grading_rubric.pdf`: human-readable grading standard
- `rubric/grading_rubric.json`: machine-readable grading standard
- `class_roster.csv`: all 20 registered students
- `submission_manifest.json`: authoritative upload and format status
- `expected_grades.json`: expected simulation outcomes for grader verification
- `students/submitted/`: 16 correctly formatted archives, including one late upload
- `students/invalid/`: 3 malformed archives
- `students/late_or_missing/`: record for the student with no uploaded archive

AI-writing risk is simulated for workflow testing. It is not treated as proof and
never creates an automatic score deduction.
