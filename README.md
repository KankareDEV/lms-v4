# LMS Project (React + Firebase + OpenAI)

This project is a Learning Management System (LMS) prototype built with **React (Vite)**, **Firebase**, and **OpenAI API**.  
It demonstrates core LMS features such as course management, announcements, materials, student enrollment, exams, and AI-assisted grading.

## 🌐 Live Demo

👉 [Click here to access the deployed project](https://lms-v4-gamma.vercel.app/login)

## How to Run Locally

1. Clone this repository:
   ```bash
   git clone https://github.com/<your-username>/<your-repo>.git
   cd <your-repo>
Install dependencies:

bash
Copy code
npm install
Run the project in development mode:

bash
Copy code
npm run dev
Open the app in your browser at:

arduino
Copy code
http://localhost:5173

Demo Credentials
You can log in with the following test accounts:

Students
juliet.wang@student-nordwest-bs.de

john.wagner@student-nordwest-bs.de

sofia.wagner@student-nordwest-bs.de

Teacher
milana.schmidt@nordwest-bs.de

The password for all accounts is:
1234567

✨ Features
Course Management: Teachers can create courses, upload materials, and schedule classes.

Exam & Coursework: Students submit coursework, teachers approve, exams unlock.

Announcements: Quick announcements and reminders sent by teachers.

AI-Assisted Grading: Uses OpenAI API for auto-marking and feedback support.

🤖 AI Question Guidance
When creating essay-type questions, you can use the following scoring weights to improve AI feedback:

Coverage: 0.6

Clarity: 0.25

Accuracy: 0.15

This helps balance the AI’s evaluation toward comprehensive and clear answers.

🌐 Deployment
The project is deployed to Vercel.

Firebase API keys (safe for frontend) are stored in .env as VITE_FIREBASE_....

OpenAI API key (secret) is stored in Vercel Environment Variables as:

ini
Copy code
OPENAI_API_KEY=your-key-here
📌 Notes
This is a demo prototype for educational purposes.

Do not use real credentials in production.

All test accounts share the same password for simplicity.

yaml
Copy code

---

Do you want me to also add a **“Screenshots” section** (with placeholders) so the README looks more polished for your professor?






You said:
Show me the full readme to copu paste


ChatGPT said:
Here you go 🚀 — a complete README.md with your Vercel link, credentials, AI guidance, and deployment info. You can copy-paste this directly into your repo.

markdown
Copy code
# 📚 LMS Project (React + Firebase + OpenAI)

This project is a Learning Management System (LMS) prototype built with **React (Vite)**, **Firebase**, and **OpenAI API**.  
It demonstrates core LMS features such as course management, announcements, materials, student enrollment, exams, and AI-assisted grading.

---

## 🌐 Live Demo

👉 [Click here to access the deployed project](https://lms-v4-gamma.vercel.app/login)

---

## 🚀 How to Run Locally

1. Clone this repository:
   ```bash
   git clone https://github.com/<your-username>/<your-repo>.git
   cd <your-repo>
Install dependencies:

bash
Copy code
npm install
Run the project in development mode:

bash
Copy code
npm run dev
Open the app in your browser at:

arduino
Copy code
http://localhost:5173
🔑 Demo Credentials
You can log in with the following test accounts:

👩‍🎓 Students
juliet.wang@student-nordwest-bs.de

john.wagner@student-nordwest-bs.de

sofia.wagner@student-nordwest-bs.de

👩‍🏫 Teacher
milana.schmidt@nordwest-bs.de

👉 The password for all accounts is:

Copy code
1234567
✨ Features
Course Management: Teachers can create courses, upload materials, and schedule classes.

Exam & Coursework: Students submit coursework, teachers approve, exams unlock.

Announcements: Quick announcements and reminders sent by teachers.

AI-Assisted Grading: Uses OpenAI API for auto-marking and feedback support.

🤖 AI Question Guidance
When creating essay-type questions, you can use the following scoring weights to improve AI feedback:

Coverage: 0.6

Clarity: 0.25

Accuracy: 0.15

This helps balance the AI’s evaluation toward comprehensive and clear answers.

🌐 Deployment
The project is deployed to Vercel.

Firebase API keys (safe for frontend) are stored in .env as VITE_FIREBASE_....

OpenAI API key (secret) is stored in Vercel Environment Variables as:

ini
Copy code
OPENAI_API_KEY=your-key-here
📌 Notes
This is a demo prototype for educational purposes.

Do not use real credentials in production.

All test accounts share the same password for simplicity.
