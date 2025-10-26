# Contributing to Drishyam3D

First off, thank you for considering contributing to Drishyam3D! It's people like you that make open source such a great community. We welcome any and all contributions.

Before you get started, please take a moment to read our [Code of Conduct](CODE_OF_CONDUCT.md).

## Table of Contents
- [How Can I Contribute?](#how-can-i-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Enhancements](#suggesting-enhancements)
  - [Your First Code Contribution](#your-first-code-contribution)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Code Style Guidelines](#code-style-guidelines)
- [Reporting Security Issues](#reporting-security-issues)
- [License](#license)

## How Can I Contribute?

### Reporting Bugs

This is one of the most helpful ways to contribute! If you find a bug, please ensure it hasn't already been reported by searching the [Issues](https://github.com/kashyaprajpal/Drishyam3D/issues) on GitHub.

If you can't find an open issue addressing the problem, please [open a new one](https://github.com/kashyaprajpal/Drishyam3D/issues/new). Be sure to include:

- A **clear and descriptive title**.
- A **detailed description** of the problem.
- **Steps to reproduce** the bug.
- The **expected behavior** and what happened instead.
- Screenshots or GIFs if they help illustrate the issue.

### Suggesting Enhancements

We'd love to hear your ideas for improving Drishyam3D! Please open an issue with the "enhancement" label and provide:

- A **clear and descriptive title**.
- A step-by-step description of the suggested enhancement in as much detail as possible.
- Explain why this enhancement would be useful to other Drishyam3D users.

### Your First Code Contribution

Unsure where to begin? You can start by looking through `good first issue` and `help wanted` issues:

- Good first issues - issues which should only require a few lines of code, and a test or two.
- Help wanted issues - issues which should be a bit more involved than `good first issues`.

## Development Setup

Drishyam3D is built with vanilla HTML, CSS, and JavaScript (using ES6 modules). You don't need any complex build tools to get started.

**IMPORTANT: Install Git LFS**

This repository uses [Git Large File Storage (LFS)](https://git-lfs.github.com/) to handle large assets like 3D models. You **must** install Git LFS on your local machine before cloning the repository.

1.  **Install Git LFS**. Follow the installation instructions on the [official website](https://git-lfs.github.com/). For example, on macOS with Homebrew: `brew install git-lfs`.
2.  **Set up Git LFS** for your user account (only needs to be done once):
    ```bash
    git lfs install
    ```
1.  **Fork** the repository on GitHub.
2.  **Clone** your fork locally:
    ```bash
    git clone https://github.com/YOUR_USERNAME/Drishyam3D.git
    ```
3.  **Navigate** to the project directory:
    ```bash
    cd Drishyam3D
    ```
4.  **Run a local web server**. As noted in the `README.md`, this is required for the browser to handle JavaScript modules correctly.
    
    If you have Python 3:
    ```bash
    python -m http.server
    ```
    
    If you have Node.js:
    ```bash
    npx http-server
    ```
5.  **Open the application** in your browser at `http://localhost:8000/html/mainpage.html`.

You are now ready to make changes!

## Pull Request Process

1.  Create a new branch for your feature or bug fix: `git checkout -b feature/MyAmazingFeature` or `bugfix/FixThatBug`.
2.  Make your changes and commit them with a clear, descriptive message.
3.  Push your branch to your fork on GitHub: `git push origin feature/MyAmazingFeature`.
4.  Open a pull request to the `main` branch of the original `Drishyam3D` repository.
5.  Fill out the pull request template with the required information. This helps us review your contribution efficiently.
6.  We will review your PR as soon as possible. Thank you for your patience!

## Code Style Guidelines

Please try to follow the coding style of the existing files.

- Use JSDoc comments for functions and modules.
- Use 4 spaces for indentation.
- Keep lines under 120 characters where possible.
- Write clear, readable code with meaningful variable names.

## Reporting Security Issues

If you discover a security vulnerability, please follow our security policy. **Do not open a public issue.** Instead, please refer to our SECURITY.md file for instructions on how to report it privately.

## License

By contributing to Drishyam3D, you agree that your contributions will be licensed under its MIT License.