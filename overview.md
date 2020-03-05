# Azure DevOps Script Retryer

That task can be used to retry several times with some delay specified script. Script will be rerun only if non-zero exit code will be detected.It could help you when for example you have some network connectivity issues. Inline script supported. Supported languages: bash, powershell, python. It looks for interpereter in PATH variable, so probably more interpreters are supported, but currently that 3 were tested. It works fine on Unix and Windows agents.

For more info please refer to documentation page on [GitHub](https://github.com/ice-ship/script-retryer/)
