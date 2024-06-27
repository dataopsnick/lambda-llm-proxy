import * as fs from 'fs';
import * as YAML from 'yaml';

// load env dictionary from SAM template
const file = fs.readFileSync('./template.yaml', 'utf8');
const samTemplate = YAML.parse(file);
const envVars = samTemplate.Resources.openaiProxy.Properties.Environment.Variables;

process.env = { ...process.env, ...envVars };