# 📚 LMS Project (React + Firebase + OpenAI)

This project is a **Learning Management System (LMS) prototype** built with **React (Vite)**, **Firebase**, and the **OpenAI API**.  
It demonstrates core LMS features such as course management, announcements, materials, student enrollment, exams, and AI-assisted grading.

---

## 🌐 Live Demo

👉 [Click here to try the deployed app](https://lms-v4-gamma.vercel.app/login)

---

## 🔑 Demo Credentials

You can log in with the following test accounts:

### 👩‍🎓 Students
- `juliet.wang@student-nordwest-bs.de`  
- `john.wagner@student-nordwest-bs.de`  
- `sofia.wagner@student-nordwest-bs.de`  

### 👩‍🏫 Teacher
- `milana.schmidt@nordwest-bs.de`

👉 The **password for all accounts** is: 1234567


---

## ✨ Features

- **Course Management** – Teachers can create courses, upload materials, and schedule classes.  
- **Exams & Coursework** – Students submit coursework; teachers approve and unlock exams.  
- **Announcements** – Teachers can send quick reminders or updates to students.  
- **AI-Assisted Grading** – Uses OpenAI API for automatic essay evaluation and feedback.  

---

## 🤖 AI Question Guidance

When creating essay-type questions, the following **scoring weights** improve AI evaluation:

- **Coverage**: `0.6`  
- **Clarity**: `0.25`  
- **Accuracy**: `0.15`  

This weighting helps ensure answers are comprehensive, clear, and factually correct.

---

## 🌐 Deployment

The project is deployed on **Vercel**.

- **Firebase API keys** (safe for frontend) are stored in `.env` using `VITE_FIREBASE_...`.  
- **OpenAI API key** (secret) is stored in **Vercel Environment Variables**:
