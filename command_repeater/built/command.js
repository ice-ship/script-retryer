var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, Promise, generator) {
    return new Promise(function (resolve, reject) {
        generator = generator.call(thisArg, _arguments);
        function cast(value) { return value instanceof Promise && value.constructor === Promise ? value : new Promise(function (resolve) { resolve(value); }); }
        function onfulfill(value) { try { step("next", value); } catch (e) { reject(e); } }
        function onreject(value) { try { step("throw", value); } catch (e) { reject(e); } }
        function step(verb, value) {
            var result = generator[verb](value);
            result.done ? resolve(result.value) : cast(result.value).then(onfulfill, onreject);
        }
        step("next", void 0);
    });
};
var fs = require('fs');
var path = require('path');
var tl = require('azure-pipelines-task-lib/task');
var uuidV4 = require('uuid/v4');
const noProfile = tl.getBoolInput('noProfile');
const noRc = tl.getBoolInput('noRc');
function translateDirectoryPath(bashPath, directoryPath) {
    return __awaiter(this, void 0, Promise, function* () {
        let bashPwd = tl.tool(bashPath)
            .arg('--noprofile')
            .arg('--norc')
            .arg('-c')
            .arg('pwd');
        let bashPwdOptions = {
            cwd: directoryPath,
            failOnStdErr: true,
            errStream: process.stdout,
            outStream: process.stdout,
            ignoreReturnCode: false
        };
        let pwdOutput = '';
        bashPwd.on('stdout', (data) => {
            pwdOutput += data.toString();
        });
        yield bashPwd.exec(bashPwdOptions);
        pwdOutput = pwdOutput.trim();
        if (!pwdOutput) {
            throw new Error(tl.loc('JS_TranslatePathFailed', directoryPath));
        }
        return `${pwdOutput}`;
    });
}
function run() {
    return __awaiter(this, void 0, Promise, function* () {
        try {
            tl.setResourcePath(path.join(__dirname, 'task.json'));
            // Get inputs.
            let input_failOnStderr = tl.getBoolInput('failOnStderr', false);
            let input_workingDirectory = tl.getPathInput('workingDirectory', /*required*/ true, /*check*/ true);
            let input_filePath;
            let input_arguments;
            let input_script;
            let old_source_behavior;
            let input_targetType = tl.getInput('targetType') || '';
            if (input_targetType.toUpperCase() == 'FILEPATH') {
                old_source_behavior = !!process.env['AZP_BASHV3_OLD_SOURCE_BEHAVIOR'];
                input_filePath = tl.getPathInput('filePath', /*required*/ true);
                if (!tl.stats(input_filePath).isFile()) {
                    throw new Error(tl.loc('JS_InvalidFilePath', input_filePath));
                }
                input_arguments = tl.getInput('arguments') || '';
            }
            else {
                input_script = tl.getInput('script', false) || '';
            }
            // Generate the script contents.
            console.log(tl.loc('GeneratingScript'));
            let bashPath = tl.which('bash', true);
            let contents;
            if (input_targetType.toUpperCase() == 'FILEPATH') {
                // Translate the target file path from Windows to the Linux file system.
                let targetFilePath;
                if (process.platform == 'win32') {
                    targetFilePath = (yield translateDirectoryPath(bashPath, path.dirname(input_filePath))) + '/' + path.basename(input_filePath);
                }
                else {
                    targetFilePath = input_filePath;
                }
                // Choose 1 of 3 behaviors:
                // If they've set old_source_behavior, source the script. This is what we used to do and needs to hang around forever for back compat reasons
                // If the executable bit is set, execute the script. This is our new desired behavior.
                // If the executable bit is not set, source the script and warn. The user should either make it executable or pin to the old behavior.
                // See https://github.com/Microsoft/azure-pipelines-tasks/blob/master/docs/bashnote.md
                if (old_source_behavior) {
                    contents = `. '${targetFilePath.replace("'", "'\\''")}' ${input_arguments}`.trim();
                }
                else {
                    // Check if executable bit is set
                    const stats = tl.stats(input_filePath);
                    // Check file's executable bit.
                    if ((stats.mode & 1) > 0) {
                        contents = `bash '${targetFilePath.replace("'", "'\\''")}' ${input_arguments}`.trim();
                    }
                    else {
                        tl.debug(`File permissions: ${stats.mode}`);
                        tl.warning('Executable bit is not set on target script, sourcing instead of executing. More info at https://github.com/Microsoft/azure-pipelines-tasks/blob/master/docs/bashnote.md');
                        contents = `. '${targetFilePath.replace("'", "'\\''")}' ${input_arguments}`.trim();
                    }
                }
                console.log(tl.loc('JS_FormattedCommand', contents));
            }
            else {
                contents = input_script;
                // Print one-liner scripts.
                if (contents.indexOf('\n') < 0 && contents.toUpperCase().indexOf('##VSO[') < 0) {
                    console.log(tl.loc('JS_ScriptContents'));
                    console.log(contents);
                }
            }
            // Write the script to disk.
            tl.assertAgent('2.115.0');
            let tempDirectory = tl.getVariable('agent.tempDirectory');
            tl.checkPath(tempDirectory, `${tempDirectory} (agent.tempDirectory)`);
            let fileName = uuidV4() + '.sh';
            let filePath = path.join(tempDirectory, fileName);
            yield fs.writeFileSync(filePath, contents, { encoding: 'utf8' });
            // Translate the script file path from Windows to the Linux file system.
            if (process.platform == 'win32') {
                filePath = (yield translateDirectoryPath(bashPath, tempDirectory)) + '/' + fileName;
            }
            // Create the tool runner.
            console.log('========================== Starting Command Output ===========================');
            let bash = tl.tool(bashPath);
            if (noProfile) {
                bash.arg('--noprofile');
            }
            if (noRc) {
                bash.arg('--norc');
            }
            bash.arg(filePath);
            let options = {
                cwd: input_workingDirectory,
                failOnStdErr: false,
                errStream: process.stdout,
                outStream: process.stdout,
                ignoreReturnCode: true
            };
            // Listen for stderr.
            let stderrFailure = false;
            const aggregatedStderr = [];
            if (input_failOnStderr) {
                bash.on('stderr', (data) => {
                    stderrFailure = true;
                    // Truncate to at most 10 error messages
                    if (aggregatedStderr.length < 10) {
                        // Truncate to at most 1000 bytes
                        if (data.length > 1000) {
                            aggregatedStderr.push(`${data.toString('utf8', 0, 1000)}<truncated>`);
                        }
                        else {
                            aggregatedStderr.push(data.toString('utf8'));
                        }
                    }
                    else if (aggregatedStderr.length === 10) {
                        aggregatedStderr.push('Additional writes to stderr truncated');
                    }
                });
            }
            // Run bash.
            let exitCode = yield bash.exec(options);
            let result = tl.TaskResult.Succeeded;
            // Fail on exit code.
            if (exitCode !== 0) {
                tl.error(tl.loc('JS_ExitCode', exitCode));
                result = tl.TaskResult.Failed;
            }
            // Fail on stderr.
            if (stderrFailure) {
                tl.error(tl.loc('JS_Stderr'));
                aggregatedStderr.forEach((err) => {
                    tl.error(err);
                });
                result = tl.TaskResult.Failed;
            }
            tl.setResult(result, null, true);
        }
        catch (err) {
            tl.setResult(tl.TaskResult.Failed, err.message || 'run() failed', true);
        }
    });
}
run();
