# Bindwright

Bindwright sets a repo up for agentic coding: the rules, session skills, guard hooks and review workflows that fit the project, made from a setup code you build on the Bindwright page. It keeps them current afterwards without overwriting your own edits.

## Use

- `/bindwright:setup <setup code>` writes the setup into the repo you are in. Files the repo already has are staged for you to merge, never overwritten.
- `/bindwright:update` brings a set-up repo up to the plugin's current templates and keeps your edits.
- `/bindwright:export` records which extras the team expects; `/bindwright:join` brings a teammate's machine in line after cloning.

A notice at session start, at most once a day, says when the repo or the plugin is behind.

## Needs

Git, and Node or Python 3.8 or later to run the setup engine. The optional extras (guard hooks and mods for `~/.claude`) are each offered with a yes or no; nothing outside the repo changes without one.

Page: https://starfoxcom.github.io/claude-code-templates/
