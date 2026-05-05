# InsightScan: AI-Based Smart Attendance System

## Thesis Draft Note

This draft is prepared from the chapter structure found in `Chapters_For_UG_Thesis_CSE_B.pdf`. Chapter 2 has been intentionally omitted as requested. The content below is tailored to the current project codebase available in this workspace, which implements a browser-based biometric attendance system using React, TypeScript, face recognition, timetable-driven attendance monitoring, and local SQLite persistence.

Use this file as the main source for your report. Replace institution-specific placeholders such as college name, department name, guide name, register number, academic year, and screenshot placeholders before final submission.

---

## Optional Front Matter

### Title Page Content

**Project Title:** InsightScan: AI-Based Smart Attendance System  
**Submitted by:** [Your Name]  
**Register Number:** [Your Register Number]  
**Department:** Department of Computer Science and Engineering  
**Institution:** [Your College Name]  
**University:** [Your University Name]  
**Submitted to:** [Guide Name / Head of Department]  
**Academic Year:** 2025-2026

### Candidate Declaration

I hereby declare that the project report entitled **"InsightScan: AI-Based Smart Attendance System"** is a bonafide record of work carried out by me under the guidance of [Guide Name], Department of Computer Science and Engineering, [College Name], and that this work has not been submitted elsewhere for the award of any other degree, diploma, or fellowship. The contents of this report are based on the software system designed, implemented, and analyzed as part of the undergraduate project work.

### Acknowledgement

I would like to express my sincere gratitude to my project guide, faculty members, and the Department of Computer Science and Engineering for their continuous encouragement, technical support, and valuable suggestions throughout the development of this project. I also thank my friends and classmates for their help in testing the system and providing constructive feedback. Finally, I am grateful to my family for their patience and support during the completion of this work.

### Abstract

Attendance management is a core administrative function in every educational institution, yet it is still handled manually in many classrooms. Traditional attendance methods depend on paper registers, verbal roll calls, or stand-alone identity checks that consume class time, increase administrative overhead, and remain vulnerable to human error and proxy attendance. These limitations become more severe in large classrooms where the teacher must balance academic engagement with routine record keeping. The growing adoption of artificial intelligence and biometric computing provides an opportunity to redesign attendance workflows so that they are faster, more reliable, and more secure.

The project titled **InsightScan: AI-Based Smart Attendance System** addresses this need by combining browser-based face recognition, timetable-driven automation, biometric identity enrollment, and local data persistence into a unified web application. The system is designed as a single-page application built using React and TypeScript. It allows an administrator to enroll securely using facial biometrics, define a recovery mechanism, register students with biometric face descriptors, manage class schedules, and monitor attendance during active class sessions. Once a scheduled class becomes active, the application continuously scans for enrolled students belonging to the relevant department and marks attendance based on multi-checkpoint verification rather than a single frame-level detection. This improves robustness and reduces false positives associated with transient appearances.

Unlike many conventional attendance solutions that depend on separate hardware terminals or central servers, the proposed system performs most of its computation locally in the browser. Face descriptors are extracted using `face-api.js`, student and administrator records are persisted using an embedded SQLite engine (`sql.js`), and historical attendance logs can be exported in CSV format for administrative use. The project also includes security-oriented features such as duplicate-face detection during student enrollment, repeated-match verification for administrator login, a lockout mechanism for suspected intrusion attempts, and recovery access through a secret key or registered Gmail address.

The implemented prototype demonstrates that a modern attendance platform can be lightweight, modular, and practical for academic environments. It improves speed, reduces manual intervention, strengthens auditability, and offers a clearer administrative workflow when compared with manual registers or loosely integrated attendance tools. This report presents the motivation, architecture, methodology, implementation details, working model, outputs, and future scope of the project.

### Keywords

Face recognition, biometric attendance, smart attendance system, React, TypeScript, browser-based AI, SQLite, liveness verification, timetable automation, academic monitoring.

### Table of Contents Note

Generate the final table of contents in Word after pasting this document. The chapter sequence should be:

1. Chapter 1 - Introduction  
2. Chapter 3 - Proposed System  
3. Chapter 4 - Implementation and Results  
4. Chapter 5 - Conclusion  
5. Appendices  

---

# Chapter 1

## Introduction

Attendance is more than a daily classroom routine. It is a formal academic record that influences internal assessment, student discipline, course continuity, eligibility rules, and institutional reporting. In most colleges and universities, attendance data is used by faculty, department offices, and academic administration for monitoring student participation and performance. Because of this, attendance systems must be accurate, easy to operate, and resistant to tampering. A delay of even a few minutes per session may look small in isolation, but when repeated across departments and semesters it creates a significant loss of academic time and administrative effort.

The transition toward smart campuses and digital academic workflows has encouraged institutions to replace manual registers with technology-enabled tracking methods. However, many existing solutions still suffer from operational gaps. Roll-call systems slow down the start of class. RFID or card-based systems may be misused if students share cards. Fingerprint-based systems depend on physical contact, which can be inconvenient, slow, or unreliable in high-throughput use. Mobile app attendance systems can be affected by device availability, location spoofing, or limited faculty oversight. As a result, there remains a strong need for an attendance system that is automatic, practical, secure, and usable inside a normal classroom environment.

Face recognition has emerged as a promising approach because the human face can be captured without direct contact and matched computationally against previously enrolled identities. Modern computer vision libraries can detect a face, localize landmarks, and generate a numerical descriptor representing distinguishing facial characteristics. When these descriptors are compared using similarity and distance measures, a system can estimate whether two samples belong to the same person. When integrated with a schedule and local storage, such biometric recognition can support real-time attendance without requiring students to manually check in.

The project developed in this work, **InsightScan**, is an AI-based smart attendance system designed specifically for academic use. The system is implemented as a web application and runs in the browser. It supports secure administrator enrollment, student biometric registration, schedule creation, live classroom monitoring, multi-phase presence validation, attendance history, and data export. The solution emphasizes low operational friction, local biometric processing, and organized attendance tracking at the department level.

This chapter introduces the background of the problem, identifies the need for improvement in existing attendance practices, and defines the main objective of the project.

## 1.1 Background

The academic environment demands timely and trustworthy attendance collection. Faculty members often begin a class by taking attendance through a physical register, by calling out student names, or by asking students to sign a sheet. Although these practices are simple to initiate, they become inefficient when the class strength is high. A classroom of sixty students may require several minutes for accurate roll call, particularly when the class includes late arrivals or name ambiguities. Over a semester, the total time spent on manual attendance can become substantial.

In addition to time loss, manual attendance is susceptible to operational inconsistencies. Students may respond on behalf of absent classmates. Paper records may be misplaced, overwritten, or damaged. Faculty members may inadvertently mark a present student absent or vice versa. Once an error enters the register, rectification becomes cumbersome because it may depend on memory, side notes, or re-verification with students. These issues reduce confidence in the reliability of the attendance record.

Digital systems were introduced to solve some of these shortcomings. Barcode, RFID, NFC, fingerprint, and mobile-based attendance methods have all been adopted in different settings. While these systems improve digitization, they still face practical limitations. Smart cards can be exchanged. Fingerprint systems require physical interaction and may slow down at scale. GPS-based mobile attendance systems can be unreliable indoors or misused using spoofing methods. Some face recognition systems exist, but many require specialized infrastructure, centralized servers, or complex deployment pipelines that are not practical for small institutions or student projects.

Artificial intelligence and edge-style processing create a new possibility: classroom attendance can be handled through visual biometric recognition with reduced dependence on additional hardware. If a standard webcam and browser can detect a face, generate a descriptor, compare it with a local identity store, and update attendance records according to schedule context, then the system becomes significantly more deployable. This makes browser-based face recognition especially attractive for educational prototypes because it can demonstrate real-time AI behavior without requiring a fully managed cloud backend.

Another relevant background factor is the need for privacy-aware design. Educational institutions increasingly expect software systems to minimize unnecessary exposure of sensitive data. A solution that processes facial descriptors locally, avoids sending raw images to a remote server for every recognition event, and stores data on the client device can serve as a more controlled starting point for biometric attendance. Such a design also makes the project easier to demonstrate in laboratory or project review settings.

The current project is therefore situated at the intersection of three needs:

- automating classroom attendance,
- improving reliability and security,
- and keeping deployment lightweight enough for real academic adoption or prototype evaluation.

The proposed system was designed after observing these needs. It combines face recognition, local persistence, schedule awareness, and admin control into a single academic workflow. In this system, attendance is not determined by a single accidental detection. Instead, the system checks presence across multiple phases of an active session, thereby aligning attendance with actual classroom continuity rather than momentary appearance.

## 1.2 Problem Statement

Despite the availability of digital tools, attendance recording in many educational environments is still inefficient, fragmented, and vulnerable to manipulation. Manual registers require faculty members to spend valuable classroom time on repetitive administrative work. Attendance systems based on physical tokens or cards can be bypassed through sharing or proxy usage. Contact-based biometric systems may be slow, expensive to maintain, and inconvenient in high-density classroom settings. Stand-alone attendance tools often lack integrated schedule awareness, secure role-based control, and meaningful historical reporting.

The main problem addressed by this project is the absence of a streamlined attendance platform that can automatically recognize students, associate them with the correct class session, and store attendance information in an organized, retrievable form. Existing approaches either do not authenticate identities strongly enough, do not support live classroom tracking, or do not provide a coherent administrative workflow for enrollment, scheduling, monitoring, history review, and export.

In academic practice, attendance should answer several questions simultaneously:

- Who was enrolled in the session?
- Which class was active at the time of monitoring?
- Was the student continuously present rather than briefly visible?
- Who is authorized to manage the system?
- How can records be reviewed or exported later?

Traditional methods answer these questions weakly or inconsistently. A faculty member may know the timetable but still record attendance manually. A digital check-in system may log an event but fail to verify whether the student remained present throughout the session. A biometric system may identify a person but not prevent enrollment duplication or unauthorized administrative access. These gaps collectively reduce confidence in the integrity of the attendance workflow.

The problem becomes sharper in environments where large student groups, multiple departments, and strict attendance requirements must be handled by limited faculty time. There is therefore a need for a system that automatically detects the currently active class, restricts recognition to the relevant department, verifies identities through facial biometrics, marks attendance through repeated confirmation logic, and stores the results in a structured database that can be managed locally.

Accordingly, this project addresses the following core problem:

**How can an academic institution implement a secure, automated, and practical smart attendance system that reduces manual effort, prevents proxy attendance, supports biometric identity management, and provides useful attendance history without requiring complex dedicated hardware or server infrastructure?**

## 1.3 Objectives

The primary objective of this project is to design and implement an AI-based smart attendance system that automates the attendance process using face recognition and schedule-aware monitoring while improving security, usability, and administrative efficiency.

The specific objectives of the project are listed below.

- To create a secure administrator enrollment and login mechanism based on biometric face verification.
- To support recovery access using a secret key and registered Gmail-based identity recovery.
- To register students with structured academic details such as register number, department, and enrollment year.
- To extract and store student facial descriptors for later recognition.
- To prevent duplicate registrations by checking register number, student name, and biometric similarity.
- To provide a timetable management module that defines the subject, department, date, and session timing.
- To automatically detect the currently active class based on the system clock and timetable data.
- To perform live face recognition only for students belonging to the department of the active class.
- To mark attendance based on multi-checkpoint presence verification rather than one-time detection.
- To maintain attendance history records for later filtering and review.
- To export attendance and history data in CSV format for academic use.
- To store administrator and student data using a local SQLite-based persistence layer running in the browser.
- To build the application using modern web technologies so that the system remains lightweight, portable, and easy to demonstrate.

The broader academic objective is to show that a well-structured browser application can integrate biometric computing, schedule automation, and local storage into a practical classroom management solution.

---

# Chapter 3

## Proposed System

This chapter presents the design logic of the project. It begins by examining the existing system and its weaknesses, then describes the proposed solution in detail, followed by system architecture, methodology, and module-level explanation.

## 3.1 Existing System

### 3.1.1 Working of Existing Systems

The most common existing attendance systems in educational institutions fall into four categories: manual attendance registers, token-based attendance systems, contact biometric systems, and basic software-based attendance tools.

In the manual register approach, the faculty member keeps a paper attendance sheet or register. At the start or end of the class, the teacher calls out names or roll numbers and marks students as present or absent. In some cases, students sign a paper sheet. This is the simplest and most widely adopted approach due to its low initial cost and minimal technology requirement.

Token-based systems such as RFID, ID card scanning, or barcode attendance use a student card to record presence. The student taps or scans the card at a device. The device logs the event along with a timestamp, and the record is later accessed through software. These systems are faster than manual roll calls but still depend on a physical token and a dedicated scanning point.

Contact biometric systems mainly use fingerprint scanners. During attendance, each student places a finger on the scanning device. The system matches the scanned pattern against a stored template and marks attendance if the match is valid. These systems provide stronger identity assurance than cards, but their throughput can be limited when many students need to scan sequentially. Hygiene, hardware wear, and sensor quality also influence real-world performance.

Some institutions use app-based or web-based digital attendance systems where faculty manually select the class and mark students through a user interface. A few advanced versions include GPS check-ins, QR scanning, or image upload features. Although these solutions improve digitization and record storage, they frequently remain dependent on manual confirmation or limited trust assumptions.

### 3.1.2 Drawbacks of Existing Systems

The existing systems described above have several drawbacks.

First, manual systems consume class time. Even a short roll call interrupts the teaching flow and reduces time available for instruction, doubt clarification, or interactive learning. This problem becomes more serious in large classrooms and in institutions where a faculty member handles multiple sessions in a day.

Second, existing systems often fail to eliminate proxy attendance. In manual roll calls, a student may answer for an absent classmate. In card-based systems, a student may lend the ID card to another person. In poorly supervised QR-based systems, a code can be shared. These issues reduce trust in the data.

Third, many systems do not verify continuity of presence. A student may check in at the beginning and leave the classroom later, yet the attendance remains marked as present. Therefore, a single event-based attendance model does not always represent actual classroom participation.

Fourth, hardware-centric systems may be costly or operationally rigid. Fingerprint scanners and RFID terminals require installation, maintenance, power, and often a centralized management setup. For a student project or a smaller institution, such dedicated infrastructure may not be feasible.

Fifth, many legacy systems do not maintain a unified workflow. Enrollment, verification, schedule definition, attendance logging, and historical analysis may be handled across separate tools or partially manual processes. This fragmentation increases the workload on faculty and administrators.

Sixth, several attendance platforms rely on network connectivity or centralized databases without providing a lightweight offline-capable workflow. If connectivity fails, attendance collection may be interrupted. On the other hand, purely local manual systems provide no analytics, no easy export, and weak searchability.

Seventh, user authentication is often weak. Many systems focus on student presence capture but do not sufficiently protect administrative operations such as enrollment, deletion, history clearance, or report export. Without strong admin control, the integrity of the attendance database may be compromised.

These drawbacks establish the need for a more integrated solution that provides strong identity verification, lower manual effort, schedule awareness, and organized storage while remaining deployable using standard web technologies.

## 3.2 Proposed System

The proposed system, named **InsightScan**, is an AI-based smart attendance platform that combines biometric face recognition, admin authentication, schedule-based activation, live attendance monitoring, local database persistence, and exportable records in a unified web interface.

At a high level, the system works as follows. An administrator first enrolls into the system by providing a name, recovery credential, recovery Gmail address, and a biometric face descriptor obtained through the camera. After enrollment, the administrator can log in through repeated face verification. Once authenticated, the administrator can register students by capturing their facial biometrics and entering their academic information. The administrator can also create class schedules by selecting subject, department, date or day, and duration.

When the current time matches a scheduled class, the system automatically identifies the active class. It then activates the live monitoring module and narrows the recognition scope to students who belong to the department of that class. Rather than marking attendance from a single recognition event, the system tracks presence across three checkpoints during the session. A student is treated as present only when the system confirms continued presence according to the checkpoint logic. This design is more aligned with actual classroom participation.

The project adopts local-browser biometric processing. Face descriptors are extracted using `face-api.js`, and identity data is stored using a client-side SQLite database powered by `sql.js`. Historical records and timetable data are also preserved using browser storage, which makes the system easy to demonstrate without deploying an external backend.

The system includes practical security measures. It verifies the administrator using a similarity threshold and requires consecutive matching attempts before granting access. It detects duplicate student enrollment by checking facial similarity against all registered identities, including the administrator profile. It also monitors suspicious admin login attempts and triggers a temporary lockout after repeated failures. If the camera is unavailable or the admin forgets the recovery secret, a Gmail-based recovery flow is supported to reset the recovery password.

### 3.2.1 Advantages of the Proposed System

The proposed system provides multiple advantages over existing attendance methods.

- It reduces classroom time spent on attendance.
- It strengthens identity verification by using biometrics instead of manual declaration.
- It reduces proxy attendance risk because presence is tied to a facial descriptor.
- It supports schedule-aware automation and eliminates the need to manually open each class.
- It uses multi-checkpoint presence logic to better represent actual attendance.
- It organizes data into admin, student, timetable, live attendance, and history workflows.
- It provides CSV export for administrative reporting.
- It avoids dependence on specialized physical attendance terminals.
- It stores records locally using SQLite for easier portability and demonstration.
- It includes recovery and lockout features for safer administration.

### 3.2.2 Scope of the Proposed System

The current implementation is best suited for departmental classroom environments where the attendance operator is an authorized administrator or faculty representative. It is particularly useful in laboratories, seminar halls, and classrooms where the camera can capture the student group adequately and where the timetable follows structured time slots.

The prototype is also educationally valuable. It demonstrates how AI, computer vision, local databases, browser APIs, and user interface engineering can be combined into a real administrative application. Therefore, the project has both practical relevance and academic depth.

## 3.3 System Architecture

The architecture of the proposed system is modular. Each module is responsible for a specific stage of the attendance workflow. This improves maintainability, readability, and extensibility.

### 3.3.1 Block Diagram

Use the following block diagram in the report. You can redraw it in Word, PowerPoint, or draw.io for a cleaner presentation.

```text
                +------------------------------------+
                |            Administrator           |
                |  Enroll / Login / Manage System   |
                +----------------+-------------------+
                                 |
                                 v
                 +---------------+----------------+
                 |      Authentication Module      |
                 | Face verification + Recovery    |
                 +---------------+-----------------+
                                 |
                                 v
                 +---------------+-----------------+
                 |         Dashboard Module         |
                 | Monitoring / Students / Schedule |
                 +-------+---------------+----------+
                         |               |
                         |               |
                         v               v
          +--------------+---+       +---+------------------+
          | Student Enrollment|       | Timetable Manager    |
          | details + biometric|      | subject/date/time    |
          +---------+---------+       +----------+-----------+
                    |                               |
                    v                               v
         +----------+-------------------------------+--------+
         |          Local Storage and SQLite Layer           |
         | admins table | students table | metadata | cache  |
         +----------+-------------------------------+--------+
                    |
                    v
         +----------+----------------------------------------+
         |            Live Attendance Monitoring             |
         | active class detection + face matching + phases   |
         +----------+----------------------------------------+
                    |
                    v
         +----------+----------------------------------------+
         |          History, Export, and Review Module       |
         | attendance logs | CSV export | analytics support  |
         +---------------------------------------------------+
```

### 3.3.2 Architectural Explanation

The administrator interacts with the system through the authentication interface and dashboard. The authentication module performs secure entry into the platform. If an admin profile does not exist, the system permits biometric enrollment after validating the recovery inputs. If an admin profile already exists, the system compares the live face descriptor with the stored admin descriptor. This module also supports password-based recovery and Gmail-based reset.

Once authenticated, the dashboard becomes the central controller of the application. It exposes three major work areas: monitoring, schedule management, and student identity management. This separation keeps the user workflow clear. Administrative tasks such as registering students or defining class schedules are distinct from live monitoring tasks.

The student enrollment module collects structured student details and biometric identity information. It interacts closely with the face recognition service and the SQLite storage layer. Before a new student is added, the system checks for duplicate facial matches, duplicate register numbers, and duplicate names. This improves the quality and trustworthiness of the stored identity vault.

The timetable manager defines when a class is active. Each timetable entry contains subject, department, start time, end time, day of week, and optionally a specific calendar date. The presence of a schedule allows the monitoring module to determine which department should be scanned at a given moment.

The storage layer is implemented using `sql.js`, which provides an embedded SQLite database running in the browser. The database stores administrator and student records. Other lightweight state such as timetable and history are stored in local storage. This architecture is adequate for a project prototype and emphasizes portability.

The live attendance module is the intelligent core of the system. It continuously checks the current time against the schedule, identifies the active class, loads the face recognition models, obtains camera input, and scans only those students who belong to the active department. Recognition candidates are reduced dynamically, and the system confirms attendance through checkpoint-wise repeated detection logic.

The final stage is the history and export module. Attendance records are preserved per student and per class session. History can be filtered by date and department, and current-session attendance or past records can be exported as CSV. This provides the bridge between real-time monitoring and academic administration.

### 3.3.3 Data Flow Description

The data flow of the system can be described in sequential form.

1. The admin opens the application.
2. The camera and face model modules prepare the biometric sensor.
3. The admin either enrolls or logs in.
4. Student data is entered and a face descriptor is captured.
5. The descriptor is validated against existing identities.
6. Approved records are stored in SQLite.
7. Class schedule entries are created and saved.
8. The system clock checks the timetable and identifies the active class.
9. Students of the relevant department become recognition candidates.
10. Live scanning runs at repeated intervals.
11. Presence is marked across checkpoints.
12. Attendance history is generated for each session.
13. CSV export is available for faculty or academic office use.

## 3.4 Methodology / Algorithm

The methodology of the proposed system is based on a sequence of biometric capture, descriptor generation, identity matching, schedule-aware filtering, and checkpoint-driven attendance confirmation. The design avoids overreliance on a single recognition moment and instead builds attendance through incremental evidence gathered during an active class session.

### 3.4.1 Overall Methodology

The overall methodology can be divided into six stages.

#### Stage 1: System Initialization

When the application starts, the interface loads the selected theme, initializes the SQLite storage layer, reads any previously saved admin profile, and prepares the biometric components. The face recognition models are loaded when needed, and the camera becomes active only when the input form requirements are satisfied.

#### Stage 2: Administrator Enrollment and Authentication

If the system does not yet contain an administrator profile, the admin enters a name, recovery secret, and Gmail account. The system then captures the face descriptor and stores it as the reference admin biometric. If the admin profile already exists, the system compares the live descriptor against the stored descriptor using cosine similarity. A successful login requires the configured threshold and repeated consecutive confirmation.

#### Stage 3: Student Enrollment

The administrator enters the student name, register number, department, and enrollment year. The system captures the student face descriptor and compares it against all previously stored student descriptors and the admin descriptor. If the face is already registered, or if the register number or name already exists, the system blocks the new entry. Otherwise, the student is saved into the database.

#### Stage 4: Timetable Definition

The administrator creates class sessions by specifying subject, department, start time, end time, and recurring day or exact calendar date. The schedule is stored and later used to determine which class is currently active.

#### Stage 5: Live Attendance Monitoring

The system checks the clock against the timetable at periodic intervals. When a class is active, the monitoring module loads the candidate descriptor list for the relevant department. The camera stream is analyzed repeatedly, and matching faces are compared against the enrolled descriptors. A student must satisfy live confirmation rules and checkpoint continuity to be considered present.

#### Stage 6: Record Generation and Export

Attendance information is converted into session records and stored in history. These records can be filtered by date or department and can be exported as CSV. This supports academic documentation, reporting, and follow-up review.

### 3.4.2 Flowchart

Use the following flowchart logic in the report. You can convert it into a diagram for better presentation.

```text
Start
  |
  v
Load UI theme and local database
  |
  v
Admin profile exists?
  |----------------------No----------------------+
  |                                              |
 Yes                                             v
  |                                    Enter admin details
  v                                              |
Capture admin face                              Capture face
  |                                              |
  v                                              v
Match with stored admin?                    Save admin profile
  |                                              |
  +---No--> increase intruder count              |
  |          lock if limit reached               |
  |                                              |
  +---Yes----------------------------------------+
  |
  v
Open dashboard
  |
  v
Register students and create timetable
  |
  v
Current time matches active class?
  |------No------> wait and recheck
  |
 Yes
  |
  v
Load descriptors for active department
  |
  v
Scan live video frames
  |
  v
Face matched strongly?
  |------No------> continue scanning
  |
 Yes
  |
  v
Confirm repeated detection for current checkpoint
  |
  v
Mark checkpoint presence
  |
  v
All checkpoints satisfied?
  |------No------> continue monitoring
  |
 Yes
  |
  v
Mark student present
  |
  v
Generate history and exportable records
  |
  v
Stop
```

### 3.4.3 Algorithm for Administrator Verification

The administrator verification process is implemented to prevent accidental or weak login decisions. The system uses cosine similarity and requires consecutive matches.

**Algorithm:**

1. Capture live face descriptor from the camera.
2. Deserialize the stored admin face descriptor.
3. Compute cosine similarity between the live descriptor and stored admin descriptor.
4. If similarity is greater than or equal to the threshold, increment the admin match streak.
5. If the match streak reaches the required consecutive count, authenticate the admin.
6. If similarity is below threshold, reset the streak.
7. Check whether the face resembles a registered student.
8. If suspicious attempts continue, increment the intruder counter.
9. If intruder count reaches the limit, activate a temporary lockout.

**Reason for this approach:**  
A single good match may occasionally occur under noisy conditions. Consecutive confirmation reduces false authentication and increases trust in admin access.

### 3.4.4 Algorithm for Student Enrollment Validation

Student enrollment is not accepted blindly. The system uses duplicate checks at three levels.

1. Validate that all input fields are filled.
2. Validate enrollment year from allowed options.
3. Load all existing student records.
4. Convert stored face descriptors into comparison candidates.
5. Add the admin descriptor to the candidate pool to prevent admin face reuse.
6. Compare the new descriptor against all candidates using Euclidean distance and cosine similarity.
7. If a registered face is detected, block enrollment.
8. Check duplicate register number.
9. Check duplicate name.
10. If all validations pass, create a new student ID.
11. Store the student record and descriptor in SQLite.
12. Re-read the record and verify that biometric data persisted correctly.
13. If persistence fails, roll back the insertion.

This methodology ensures that the identity vault remains internally consistent and secure.

### 3.4.5 Algorithm for Live Attendance

The live attendance algorithm is the most important part of the project because it turns biometric recognition into a meaningful attendance decision.

1. Determine whether a class is active using current time and timetable.
2. Select only students belonging to the active class department.
3. Compute checkpoint boundaries according to class duration.
4. Start live video monitoring.
5. Detect all faces in the frame.
6. For each detected face, compare it with the candidate descriptors.
7. Rank possible matches using distance and similarity.
8. Accept a match only if thresholds and separation margins are satisfied.
9. Track repeated detections for the same student during the current checkpoint.
10. When the required live confirmation count is reached, mark that checkpoint as passed.
11. Continue the same logic for the remaining checkpoints.
12. A student is considered fully present only if all checkpoints up to the current stage are satisfied continuously.

The multi-checkpoint design makes the system stronger than one-shot attendance because it rewards continuity rather than momentary presence.

### 3.4.6 Pseudocode

```text
for each active class:
    candidates = students where department == activeClass.department
    checkpoints = divide(classDuration, 3)

    while class is active:
        detectedFaces = detectAllFaces(cameraFrame)
        matchedIds = []

        for each face in detectedFaces:
            ranked = compare(face.descriptor, candidates)
            best = selectStrongestValidMatch(ranked)
            if best is valid:
                updateMatchStreak(best.id, currentCheckpoint)
                if streak(best.id) >= liveConfirmationRequired:
                    matchedIds.append(best.id)

        markCheckpointPresence(matchedIds, currentCheckpoint)
        updateHistoryRecords()
```

### 3.4.7 Why This Methodology Is Suitable

This methodology is suitable for the project because it balances practical deployment with meaningful attendance logic. It avoids requiring heavy server infrastructure, yet it still enforces identity validation, duplicate prevention, and repeated confirmation. The approach is computationally manageable for a browser-based environment and aligns well with academic attendance requirements.

## 3.5 Module Description

The project is organized into modules so that each subsystem handles a focused responsibility. This improves maintainability and future extensibility.

### 3.5.1 Module 1: Authentication and Access Control

The authentication module controls entry to the system. It supports both first-time admin enrollment and later admin login. When no admin exists, the system permits secure enrollment only after the required details are provided. When an admin already exists, live biometric verification is performed against the stored descriptor.

This module also includes a recovery path. If the camera becomes unavailable or the admin cannot log in through facial verification, the system supports recovery through a secret credential. In addition, the Gmail-based recovery reset allows the admin to update the recovery password if the registered Gmail matches the stored recovery address. This design improves resilience without removing the importance of admin authorization.

Another important responsibility of this module is intrusion handling. When repeated failed login attempts occur, especially when the detected face resembles a student profile or does not match the admin, the system increments an intrusion count. If the count reaches the configured limit, a lockout timer is triggered. This protects the administrative interface from persistent unauthorized access.

### 3.5.2 Module 2: Face Scanner and Liveness-Oriented Capture

The face scanner module manages camera access, model loading, live face detection, progress display, and descriptor generation. It uses browser media APIs to access the webcam and applies fallback camera constraints if ideal settings are not available. This improves compatibility across devices.

The scanner also incorporates a stability-based capture process. Instead of immediately sending the first descriptor it sees, the module collects a sequence of descriptors and checks their similarity across frames. If the face moves too abruptly, the sequence is reset. If a stable sequence is maintained long enough, the descriptors are averaged to improve precision. This acts as a practical liveness-oriented measure and reduces noisy one-frame matches.

The scanner presents visual feedback to the user through a face box, liveness progress indicator, camera status messages, and recovery suggestions when camera problems occur. This improves usability and makes the biometric process understandable even for non-technical users.

### 3.5.3 Module 3: Student Enrollment Module

The student enrollment module allows the admin to add student records into the identity vault. Each record contains:

- student ID,
- register number,
- name,
- email,
- department,
- enrollment year,
- attendance status,
- and face descriptor.

This module is not only a data entry form; it is a biometric validation stage. Before saving the student, the module checks whether the same face already exists in the system, whether the register number is already in use, and whether the same student name is already present. This reduces inconsistencies and prevents intentional or accidental duplication.

The module also verifies that the biometric payload is actually persisted after insertion. If persistence fails, the system rolls back the student entry rather than keeping an incomplete record. This is an important detail because it preserves database integrity.

### 3.5.4 Module 4: Timetable Management Module

The timetable management module allows the admin to define class sessions by subject, department, date, day of week, and time range. It supports both recurring weekly classes and date-specific sessions. The module also calculates end time automatically from a selected class duration, which improves usability and reduces input error.

This module is important because the project does not treat attendance as a generic always-on activity. Instead, the system becomes context aware. By knowing what class should be active at a given time, the platform can:

- identify the relevant department,
- reduce the recognition candidate pool,
- and associate attendance with the correct subject and session.

This schedule awareness is one of the major improvements over simple camera-based recognition demos that detect faces but do not know which class they belong to.

### 3.5.5 Module 5: Live Monitoring and Checkpoint Attendance Module

This module implements real-time attendance marking. It becomes active when the current time matches a timetable entry. The module loads only those student descriptors that belong to the active department and performs repeated face matching using the camera stream.

The distinctive feature of this module is the checkpoint-based attendance logic. Each class session is divided into three phases: beginning, middle, and end. A student is considered on track only if the earlier checkpoints are also satisfied. This prevents a student from being marked present solely because they appeared once.

The module also adapts the scan interval depending on the number of pending recognition candidates. If more candidates remain to be recognized, scanning occurs more aggressively. If fewer candidates remain, the interval is relaxed slightly. This is a practical strategy for balancing responsiveness and computational overhead.

### 3.5.6 Module 6: History Vault and Export Module

The history module converts live attendance information into structured session records. For each class and each student, the system maintains date, subject, department, register number, and attendance status. These records can later be filtered by date and department so that administrators can review attendance in a meaningful way.

The export functionality converts current attendance or filtered history into CSV files. This is valuable because most academic offices still rely on spreadsheet-compatible formats for review, circulation, and archival. Therefore, CSV export serves as a bridge between the smart attendance platform and the existing administrative workflow.

### 3.5.7 Module 7: Local Database and Persistence Module

Persistence is handled through a client-side SQLite layer built using `sql.js`. The system stores admin data, student records, and metadata in structured relational tables. This is more robust than storing all information in unstructured browser key-value pairs. The database is serialized and saved into browser storage so that records remain available across sessions.

This module also contains a migration mechanism for legacy local storage data. If earlier versions of the project stored admin or student data directly in local storage, the service imports that data into the SQLite schema. This reflects thoughtful engineering and makes the project evolution-friendly.

### 3.5.8 Module 8: User Interface and Administrative Dashboard

The dashboard presents the entire system in a visually organized interface. It contains separate tabs for monitoring, schedule management, and student identity management. It also supports theme toggling and summary cards for quick review of attendance, class state, student totals, and department distribution.

A well-designed administrative dashboard is important because institutional tools succeed only when they are easy to operate. The user interface of this project is therefore not a decorative element; it is part of the system's practical usability. The clear separation between live monitoring, student records, and scheduling makes the workflow easier for an operator to understand and manage.

---

# Chapter 4

## Implementation and Results

This chapter explains how the proposed system was implemented, what technologies were used, how the system operates in practice, and what kinds of outputs are generated. Where exact experimental numbers are not available from the current codebase alone, the discussion focuses on verifiable system behavior and report-ready result presentation.

## 4.1 Tools and Technologies Used

### 4.1.1 Software Technologies

The project uses a modern front-end technology stack. The major tools and technologies are shown in the table below.

| Tool / Technology | Type | Role in Project |
|---|---|---|
| React 19 | Front-end library | Builds the component-based user interface |
| TypeScript | Programming language | Adds type safety and improves maintainability |
| Vite | Build tool | Fast development server and production bundling |
| Tailwind CSS CDN | UI styling utility | Rapid styling of dashboard and forms |
| Font Awesome | Icon library | Visual icons for UI clarity |
| face-api.js | AI/computer vision library | Face detection, landmarks, and descriptor generation |
| sql.js | Client-side database engine | Browser-based SQLite storage |
| localStorage | Browser storage | Stores serialized SQLite DB, timetable, theme, and history |
| Google GenAI SDK | AI service integration | Provision for attendance summary generation |
| JavaScript Web APIs | Runtime environment | Camera access, timing, export, local persistence |

#### React

React is used to structure the application into reusable functional components. The main application uses distinct components such as `App`, `FaceScanner`, and `Dashboard`, which makes the system easier to reason about and extend. React state and hooks are used extensively to manage authentication status, live scanner state, timetable updates, presence data, and administrative interactions.

#### TypeScript

TypeScript improves the correctness of the project by defining explicit types for students, timetable entries, admin profiles, history records, and authentication state. Because attendance systems manipulate structured information, type definitions are beneficial in preventing accidental misuse of data fields. This also makes the codebase more suitable for academic explanation.

#### Vite

Vite is used as the development and build environment. It provides quick local startup and a clean production build process. During verification, the project successfully built for production using Vite, confirming that the current codebase is deployable as a static front-end application.

#### face-api.js

The most important AI technology used in the project is `face-api.js`. It performs face detection, landmark estimation, and descriptor extraction. The system loads models such as Tiny Face Detector, Landmark 68 Net, and Face Recognition Net from a CDN location. These models enable real-time browser-based face recognition without requiring a separate Python backend.

#### sql.js and SQLite

Instead of using a remote relational database server, the project uses `sql.js`, a WebAssembly-powered SQLite engine that runs in the browser. This allows the system to preserve a relational structure while remaining easy to demonstrate locally. Admin data and student records are stored in a proper schema with constraints and metadata support.

#### Browser APIs

The application uses browser features such as camera capture, timers, blobs for file export, and local storage. These APIs are essential because the entire system is designed to operate as a practical web application on a standard machine with a webcam.

### 4.1.2 Hardware Requirements

The hardware requirements for the prototype are minimal when compared to many biometric systems.

| Hardware | Purpose |
|---|---|
| Laptop or desktop computer | Runs the web application |
| Webcam or integrated camera | Captures live face data |
| Minimum 4 GB RAM | Supports browser execution and model loading |
| Multi-core processor | Improves UI responsiveness and image processing |
| Stable internet connection | Needed for first-time model loading and optional AI service |

The low hardware requirement is one of the strengths of the project because it reduces the deployment barrier.

### 4.1.3 Development Environment

The project is organized as a Vite application. Core files include:

- `App.tsx` for authentication and overall workflow,
- `components/FaceScanner.tsx` for live camera-based biometric capture,
- `components/Dashboard.tsx` for monitoring, schedule, and student management,
- `services/faceRecognitionService.ts` for descriptor extraction and matching logic,
- `services/sqliteService.ts` for persistence,
- `services/geminiService.ts` for attendance summary integration.

This structure reflects a modular design suitable for academic projects because the responsibility of each file can be explained clearly during viva or evaluation.

## 4.2 System Implementation

The implementation of the proposed system follows the modular architecture described in the previous chapter. This section explains how each major feature appears in the software.

### 4.2.1 Authentication Screen Implementation

The landing page of the system acts as the security boundary of the platform. It is implemented in `App.tsx` and combines branding, input validation, biometric scanning, and recovery workflows. The page supports two main modes:

- admin authentication mode,
- and student registration mode.

During first-time use, the administrator enters a name, recovery secret, and recovery Gmail address. Only after valid inputs are provided does the camera scanner activate for biometric enrollment. This reduces accidental camera usage and improves onboarding clarity.

When an admin profile is already present, the authentication screen switches from enrollment behavior to identification behavior. The system captures the live face descriptor and compares it with the stored admin descriptor. If similarity exceeds the configured threshold and the required match streak is satisfied, access is granted to the dashboard.

If the scanner encounters a technical problem or the admin does not remember the recovery secret, the recovery UI becomes active. This makes the platform more realistic than demo-only systems that fail completely when biometric capture is unavailable.

**Screenshot placeholder:**  
[Insert Screenshot 4.2.1: Home page showing admin authentication interface]

### 4.2.2 Face Scanner Implementation

The face scanner component is responsible for camera initialization, face box visualization, stable capture logic, and liveness-like progress feedback. It requests camera access with a series of fallback constraints so that the system can still operate even when ideal resolution settings are not available.

The component displays a progress ring during stable face capture. Rather than sending a single descriptor immediately, it stores a short buffer of consecutive descriptors. If the new descriptor deviates too much from the previous stable descriptor, the buffer is reset. Once the buffer reaches the configured threshold, the descriptors are averaged and sent to the parent component.

This design improves reliability in two ways. First, it reduces noisy one-frame results. Second, it creates a user-visible sense of biometric progression, which makes the system easier to operate in practice.

**Screenshot placeholder:**  
[Insert Screenshot 4.2.2: Face scanner with liveness progress and face bounding box]

### 4.2.3 Student Enrollment Implementation

Student registration is implemented through the authentication workflow and SQLite service. The administrator enters student details such as name, register number, department, and enrollment year. Once the face is captured, the project compares the descriptor with all enrolled identities. This includes checking against both student and admin facial data.

Duplicate filtering is not performed using a single metric alone. The project compares both Euclidean distance and cosine similarity, then ranks the matches and checks whether the best match is sufficiently separated from the second-best candidate. This is an intelligent implementation choice because it reduces the chance of accidental false duplicate decisions.

The system also checks duplicate names and duplicate register numbers, which helps preserve administrative clarity. After successful insertion, the system verifies whether the face descriptor was actually persisted. If not, the student record is removed and the operator is instructed to retry.

**Screenshot placeholder:**  
[Insert Screenshot 4.2.3: Student registration form before biometric capture]  
[Insert Screenshot 4.2.4: Successful student enrollment toast message]

### 4.2.4 Dashboard Implementation

The dashboard is the operational center of the application. It uses a tabbed interface with three major areas:

- Monitoring,
- Schedule,
- Identities.

The monitoring section contains live attendance observation and history review. The schedule section allows new class registration and timetable viewing. The identities section displays student statistics, batch filters, and deletion operations.

The interface also supports theme switching between dark and light modes. Theme persistence improves usability and makes the interface feel like a complete product rather than a one-screen prototype.

**Screenshot placeholder:**  
[Insert Screenshot 4.2.5: Main dashboard after admin login]

### 4.2.5 Schedule Management Implementation

The schedule module allows the administrator to define the subject, department, class date, day, duration, and start time. The system converts 12-hour user input into 24-hour time internally and computes the end time automatically based on the selected duration.

This reduces the chance of operator error and makes schedule creation faster. Once saved, the timetable is stored in local storage and later used by the active-class detection logic. Date-specific entries are given higher priority than recurring entries for the same period, which reflects a practical approach to real academic schedules.

**Screenshot placeholder:**  
[Insert Screenshot 4.2.6: Add class / schedule management form]

### 4.2.6 Live Monitoring Implementation

The live monitoring implementation combines time awareness, face matching, and checkpoint tracking. The system checks the current time against the timetable every few seconds. If a class session is currently active, it filters students by the department of that class and initializes the live recognition loop.

The module repeatedly scans the camera stream, extracts all descriptors, and compares them with the enrolled student descriptors. Match acceptance is based on:

- minimum cosine similarity,
- maximum Euclidean distance,
- and margin-based separation from the second-best candidate.

After a valid match is found, the system does not immediately mark final attendance. Instead, it builds streak information per checkpoint. Only after the same student has been recognized enough times within the active checkpoint does the system mark that checkpoint as satisfied.

This is one of the strongest implementation features of the project because it transforms raw face recognition into a more academic notion of attendance continuity.

**Screenshot placeholder:**  
[Insert Screenshot 4.2.7: Live monitoring screen during an active class]

### 4.2.7 History and Export Implementation

The history module continuously converts current class status into per-student attendance records for the day. Records are sorted and stored so that the history view can later filter them by date and department. This gives the project an archival dimension that many demo systems lack.

The export feature generates CSV data for both current attendance and historical records. It uses a browser blob and download link to create a file without requiring a server. This makes the system immediately useful for faculty who want spreadsheet-compatible output.

**Screenshot placeholder:**  
[Insert Screenshot 4.2.8: History vault with date and department filters]  
[Insert Screenshot 4.2.9: CSV export result or downloaded file view]

### 4.2.8 Database Implementation

The SQLite service creates three logical areas:

- `metadata`,
- `admins`,
- `students`.

The `admins` table stores the admin name, face descriptor, recovery secret, recovery email, and registration date. The `students` table stores student identity information including register number and biometric descriptor. The `metadata` table is used for migration tracking and other small values.

The database is exported into a byte array and encoded into a string for storage in local storage. On the next load, the byte array is reconstructed and the SQLite database is recreated. This approach allows the project to preserve relational data without external servers.

### 4.2.9 Implementation Quality Observations

Several implementation details improve the quality of the project:

- use of strong type definitions for core data models,
- duplicate biometric checks before student insertion,
- rollback on failed biometric persistence,
- admin lockout after repeated intrusion attempts,
- repeated confirmation for admin login,
- checkpoint-based live attendance logic,
- structured tabbed dashboard for administrative operations,
- successful production build verification during project review.

Together these details show that the project is more than a superficial demo; it contains meaningful application logic and data handling decisions.

## 4.3 Working Model

The working model describes how the system behaves end to end in practical use.

### 4.3.1 Step-by-Step Execution

**Step 1: Application Launch**  
The operator opens the application in a browser. The system loads saved theme settings and initializes the local SQLite storage. If an admin record already exists, the app prepares for admin identification. Otherwise, it prepares for admin enrollment.

**Step 2: Admin Enrollment or Login**  
For first-time use, the admin enters name, recovery secret, and Gmail address, then completes facial enrollment through the scanner. For subsequent use, the admin faces the camera and the system verifies identity using biometric comparison and repeated confirmation.

**Step 3: Recovery Path if Needed**  
If the scanner cannot be used or the admin forgets the recovery secret, the system allows recovery through stored credentials. Gmail-based password reset is also supported if the registered recovery email is correctly supplied.

**Step 4: Student Registration**  
Once inside the dashboard or registration workflow, the admin enters student details and captures the student's face. The system prevents duplication and stores the record in the local SQLite identity vault.

**Step 5: Timetable Creation**  
The admin defines class schedules with subject, department, and time period. These schedules determine when live attendance should activate.

**Step 6: Active Class Detection**  
The system continuously checks the current system time and date. If a timetable entry matches, that class becomes the active class. The dashboard automatically aligns itself with the monitoring workflow.

**Step 7: Department-Limited Recognition**  
Only students from the active class department are considered recognition candidates. This narrows the search space and improves operational relevance.

**Step 8: Face Detection and Matching**  
The monitoring camera captures the classroom. Detected faces are compared with enrolled descriptors using similarity and distance measures. Only strongly valid matches are accepted.

**Step 9: Checkpoint Presence Validation**  
The class duration is divided into three logical phases. The student must be recognized in sequence across these checkpoints. The system stores timestamps and marks checkpoint completion.

**Step 10: Attendance Statistics and Session View**  
The dashboard displays live statistics such as total enrolled, present, absent, and attendance percentage. The operator can observe who has already cleared the current checkpoint.

**Step 11: History Generation**  
Per-student session records are generated and updated. These records reflect whether the student is presently treated as present or absent in the relevant session.

**Step 12: Export and Administrative Review**  
The admin can export the current session or filtered history into CSV format. This supports reporting, archiving, and academic review.

### 4.3.2 Working Scenario Example

Consider a classroom session for the Computer Science Engineering department from 09:00 to 10:00 AM.

1. The administrator logs in to the application through biometric verification.
2. Students have already been enrolled with their names, register numbers, and face descriptors.
3. A class titled "Advanced AI Systems" is registered from 09:00 AM to 10:00 AM for the CSE department.
4. At 09:02 AM, the application identifies this class as active.
5. The system loads only the descriptors of CSE students.
6. The live monitor begins checking for student faces.
7. A student detected in the beginning phase is not immediately considered fully present; only the first checkpoint is marked.
8. During the middle checkpoint, the same student is detected again and the second checkpoint is updated.
9. During the end checkpoint, the student is detected again, confirming continuous classroom presence.
10. The history vault stores the student as present for the session.

This scenario shows how the project attempts to model actual presence over time rather than a single appearance.

### 4.3.3 Failure and Recovery Cases

The working model also includes failure-aware behavior.

- If the camera is not accessible, the system shows technical guidance.
- If the admin face does not match, the system increments suspicious attempt counts.
- If repeated suspicious attempts occur, a lockout is applied.
- If the enrollment face already belongs to another person, registration is blocked.
- If biometric persistence fails, the insertion is rolled back.
- If no active class exists, monitoring remains idle rather than generating irrelevant attendance events.

These cases increase the maturity of the prototype and provide meaningful discussion points in the report or viva.

## 4.4 Results and Outputs

This section presents the outputs generated by the system and report-ready ways to document the implementation results.

### 4.4.1 Functional Output Summary

The implemented system successfully provides the following outputs:

- administrator biometric enrollment,
- administrator biometric login,
- admin recovery access,
- student biometric registration,
- duplicate face detection,
- schedule creation,
- live attendance monitoring,
- checkpoint-based presence marking,
- attendance percentage display,
- history review,
- CSV export of attendance data.

These outputs demonstrate that the project covers the major life cycle of an attendance platform from secure setup to final record export.

### 4.4.2 Example System Messages

The software generates practical messages that reflect internal state transitions. Example outputs based on the current implementation include:

- "Loading Secure Vault..."
- "Ready for Biometric Enrollment"
- "Identifying: [Admin Name]"
- "Processing Biometrics..."
- "Admin verification 1/2"
- "Intruder Detected: Access Denied"
- "Registration blocked: Face already registered"
- "Registration successful"
- "Recovery password updated. Enter it to continue."

These messages can be quoted briefly in the report to show user feedback design.

### 4.4.3 Sample Result Table for Admin Authentication

Use a result table like the one below.

| Test Case | Input Condition | Expected Output | Observed Behavior |
|---|---|---|---|
| First-time admin enrollment | Valid name, recovery secret, Gmail, and face | Admin profile stored | Successful |
| Correct admin login | Matching admin face | Dashboard opens | Successful |
| Wrong face at admin login | Face not matching admin | Access denied | Successful |
| Repeated failed attempts | Multiple suspicious tries | Lockout activated | Successful |
| Recovery password login | Valid recovery secret | Admin access granted | Successful |

### 4.4.4 Sample Result Table for Student Enrollment

| Test Case | Condition | Result |
|---|---|---|
| New student with unique face | All valid details entered | Student added successfully |
| Duplicate register number | Existing register number entered | Enrollment blocked |
| Duplicate name | Existing student name entered | Enrollment blocked |
| Duplicate face | Existing face descriptor detected | Enrollment blocked |
| Missing biometric persistence | Simulated storage problem | Insertion rolled back |

### 4.4.5 Sample Result Table for Timetable and Monitoring

| Feature | Expected System Output | Observed Outcome |
|---|---|---|
| Scheduled class start | Active class selected automatically | Achieved |
| No scheduled class | Monitoring remains idle | Achieved |
| Department-specific class | Only relevant students scanned | Achieved |
| Checkpoint progression | Beginning, middle, end tracking | Achieved |
| CSV export | Downloadable attendance file | Achieved |

### 4.4.6 Illustrative Attendance Output

The following sample table may be used in the report to demonstrate a live session outcome. Mark it clearly as an illustrative output if you did not conduct a full measured experiment.

| Student ID | Register Number | Name | Department | Beginning | Middle | End | Final Status |
|---|---|---|---|---|---|---|---|
| STU10021 | CSE24001 | Student A | CSE | Yes | Yes | Yes | Present |
| STU10022 | CSE24002 | Student B | CSE | Yes | No | No | Absent |
| STU10023 | CSE24003 | Student C | CSE | Yes | Yes | No | Absent |
| STU10024 | CSE24004 | Student D | CSE | No | No | No | Absent |
| STU10025 | CSE24005 | Student E | CSE | Yes | Yes | Yes | Present |

This table helps explain the difference between one-time detection and continuity-based attendance.

### 4.4.7 CSV Output Structure

The project supports CSV export in two forms.

**Current attendance CSV fields:**

- Student ID
- Register Number
- Name
- Department
- Status
- Verification Time

**History CSV fields:**

- Record ID
- Date
- Name
- Register Number
- Subject
- Department
- Attendance

These outputs are useful for academic offices because they can be opened directly in spreadsheet software.

### 4.4.8 Screenshot Plan for Final Report

To strengthen the results section, include the following screenshots:

- landing page with admin biometric login,
- face scanner with detection progress,
- admin recovery screen,
- student registration form,
- successful registration notification,
- dashboard overview,
- live attendance monitoring screen,
- schedule creation form,
- timetable list,
- identities tab,
- history vault,
- exported CSV sample.

This screenshot sequence will add visual depth and help the report comfortably extend in page count.

### 4.4.9 Graphs and Figures You Can Add

For better marks, you can create simple graphs in Excel from illustrative or measured values:

- attendance percentage by session,
- number of students present versus absent,
- enrollment count by department,
- batch-wise student strength,
- comparison of manual attendance time versus automated attendance time.

These graphs do not need a complex dataset. Even a small demonstration dataset can significantly improve presentation quality.

## 4.5 Performance Analysis

Performance analysis is one of the most important parts of this report because it explains whether the proposed attendance system is not only functional, but also reliable and efficient in practice. For this project, performance should be discussed in two clearly separated ways:

- **implementation-based facts**, which are directly supported by the code,
- and **measured accuracy values**, which should only be reported if a proper experiment was conducted.

This distinction is academically important. Since the current repository does not include a formally labeled benchmark dataset or full recognition test log, it is **not correct to claim a fixed overall facial recognition accuracy percentage such as 95% or 98%** unless such testing was actually performed. Therefore, the most correct way to write the performance analysis is to explain accuracy in terms of the mechanisms used to improve correctness, and to explain efficiency in terms of workflow and computation.

### 4.5.1 Performance Metrics and Design Parameters

The current codebase contains several parameters that directly affect reliability, speed, and security. These values are implementation facts and can be safely stated in the report.

| Parameter | Configured Value | Performance Meaning |
|---|---|---|
| Admin match threshold | 0.94 cosine similarity | High-confidence admin verification |
| Admin consecutive matches | 2 | Reduces accidental one-frame login |
| Stable capture threshold | 8 frames | Improves descriptor quality before acceptance |
| Duplicate face distance threshold | 0.42 | Prevents already-enrolled face duplication |
| Duplicate face cosine threshold | 0.95 | Strengthens duplicate-face confirmation |
| Attendance checkpoints | 3 | Measures continuity of presence across session |
| Live confirmation count | 2 | Requires repeated recognition before checkpoint is marked |
| Scan interval | 650 to 1000 ms | Balances responsiveness and browser load |
| Intruder attempt limit | 3 | Strengthens admin-side protection |
| Lockout duration | 30 seconds | Reduces repeated unauthorized attempts |

These values show that the project is not performing naive one-shot recognition. Instead, it uses thresholding, repeated confirmation, and checkpoint continuity to improve correctness and reduce false decisions.

### 4.5.2 Accuracy Analysis

In this project, accuracy should be understood at two levels:

1. **face recognition accuracy**, which refers to whether the correct face is matched to the correct identity;
2. **attendance marking accuracy**, which refers to whether the final present/absent decision correctly represents actual classroom presence.

The current implementation improves both of these levels through multiple validation stages.

#### A. Face Recognition Accuracy

The system does not depend on a single image frame to verify identity. Instead, it improves recognition reliability through the following design choices:

- a stable capture requirement of 8 frames before the descriptor is accepted,
- averaging of stable descriptors to reduce noise,
- combined use of cosine similarity and Euclidean distance,
- candidate ranking and margin checking against the second-best match,
- separate thresholds for admin verification and duplicate enrollment detection,
- repeated live confirmation before checkpoint approval.

These steps reduce the probability of false acceptance and false rejection when compared with a simple one-frame, single-threshold face matching approach. In particular, the requirement that a match must be both close in Euclidean distance and high in cosine similarity makes the system more selective. Similarly, the requirement that the best candidate must be sufficiently separated from the second-best candidate reduces ambiguity in classrooms where multiple faces may appear in the same frame.

#### B. Attendance Marking Accuracy

Attendance accuracy in the proposed system is stronger than simple event-based attendance because the platform does not mark a student permanently present after one brief detection. Each class session is divided into three phases:

- beginning,
- middle,
- end.

The student must remain detectable across checkpoints in order to remain "on track" for present status. This means the final attendance decision reflects continuity of presence rather than just entry into the classroom. As a result, the system is better aligned with real classroom participation and less vulnerable to short-term or proxy-like appearances.

#### C. Correct Academic Statement for the Report

You can safely use the following paragraph in your report:

> The proposed system improves attendance accuracy through stable-frame biometric capture, dual-metric face comparison, repeated confirmation, and multi-checkpoint presence validation. Since the current prototype has not yet been evaluated on a formally labeled benchmark dataset, the report does not claim a fixed numerical recognition accuracy. Instead, accuracy is justified through the system design and its error-reduction mechanisms.

That paragraph is academically safe and correct for your current project state.

#### D. If You Conduct an Experiment Later

If you later perform testing with real students, you can calculate accuracy using the following formulas:

**Recognition Accuracy**

```text
Recognition Accuracy (%) =
  (Number of correct face matches / Total number of recognition attempts) x 100
```

**Attendance Marking Accuracy**

```text
Attendance Accuracy (%) =
  (Number of correctly marked attendance records / Total attendance records checked) x 100
```

**Precision**

```text
Precision = TP / (TP + FP)
```

**Recall**

```text
Recall = TP / (TP + FN)
```

Where:

- `TP` = true positive,
- `FP` = false positive,
- `FN` = false negative.

If you do not have actual counted values for `TP`, `FP`, and `FN`, do not include fake numerical precision or recall in the final report.

### 4.5.3 Efficiency Analysis

Efficiency in this project should be discussed in two forms:

- **operational efficiency**, meaning how much classroom effort is reduced,
- **computational efficiency**, meaning how the system reduces unnecessary processing.

#### A. Operational Efficiency

In a manual attendance system, the teacher typically spends several minutes calling names or checking responses, especially in classes with high student strength. In contrast, the proposed system performs biometric attendance passively once students are enrolled and the timetable is configured. The operator does not need to verify every student one by one during the session. This reduces faculty workload and preserves teaching time.

The schedule-aware design also improves efficiency. The system checks the current time and activates monitoring only when a scheduled session is active. This avoids unnecessary continuous scanning and prevents irrelevant attendance events from being generated outside class time.

The history and CSV export modules further improve administrative efficiency because attendance data can be reviewed or exported immediately without rewriting registers into spreadsheets.

#### B. Computational Efficiency

The project includes several computational optimizations:

- only students from the active class department are loaded as recognition candidates,
- already-cleared students are progressively removed from pending recognition focus,
- scan interval adapts between 650 ms and 1000 ms based on pending student count,
- local browser processing reduces repeated server communication,
- current checkpoint logic avoids unnecessary repeated marking for students already confirmed.

These choices reduce redundant comparisons and make the system more practical for classroom use. Candidate filtering is especially important because it lowers the number of face comparisons that must be performed per scan cycle.

#### C. Efficiency Statement for the Report

You can safely use the following write-up:

> The proposed system improves efficiency by automating attendance after initial enrollment and timetable setup. Faculty involvement during class is reduced because the system identifies the active session automatically, scans only the relevant department, and updates attendance progressively. Computational efficiency is improved through candidate filtering, adaptive scan timing, and local browser-based processing.

### 4.5.4 Security and Robustness Contribution to Performance

Although security is not always listed separately under performance, it directly influences the correctness of attendance records. A fast system is not useful if unauthorized users can alter data or access the dashboard.

The current project improves robustness through:

- biometric admin authentication,
- two-step consecutive admin confirmation,
- duplicate face prevention during enrollment,
- student-face detection during suspicious admin attempts,
- maximum attempt limit of three,
- temporary 30-second lockout,
- recovery secret and Gmail-based reset support.

These controls increase trust in the generated attendance data. Therefore, security in this project should be treated as part of overall performance quality, not merely as an optional add-on.

### 4.5.5 Comparison with Existing System

The performance advantage of the proposed system can be summarized using the following table.

| Criterion | Manual Register | RFID / Card | Basic Digital Marking | Proposed System |
|---|---|---|---|---|
| Direct class time spent on attendance | High | Medium | Medium | Low after setup |
| Proxy attendance resistance | Very low | Low | Low to medium | Higher |
| Continuity of presence verification | No | No | Usually no | Yes |
| Identity assurance | Weak | Medium | Weak to medium | Stronger |
| Schedule-aware automation | No | Limited | Limited | Yes |
| Need for dedicated hardware terminal | No | Yes | Usually no | Webcam only |
| Record export and review | Manual | Available in some systems | Yes | Yes |
| Admin protection | Weak | Medium | Varies | Stronger |

This comparison shows that the proposed system provides better correctness and better workflow efficiency than manual attendance, while remaining lighter than hardware-heavy biometric installations.

### 4.5.6 Limitations of the Current Prototype

For a correct academic report, the limitations must also be stated clearly.

- The project does not currently include a formal benchmark dataset or large-scale measured accuracy log.
- Recognition quality may vary with lighting conditions, camera quality, face angle, occlusion, and classroom crowd density.
- The system currently works as a browser-based prototype and stores data locally.
- Face model files are loaded from an external source, so first-time model loading depends on internet access.
- The AI reporting service is present in the repository but is not yet a central measured part of the performance workflow.

These limitations do not reduce the value of the project. Instead, they show that the report distinguishes clearly between implemented capability and experimentally validated numerical claims.

### 4.5.7 Recommended Measured Evaluation Table

If you want to add a small experiment in the final report, use a table like this after real testing:

| Metric | Formula | Value |
|---|---|---|
| Total recognition attempts | Count of all scan attempts | [Fill after test] |
| Correct recognitions | Count of correct matches | [Fill after test] |
| False positives | Wrong identity accepted | [Fill after test] |
| False negatives | Valid identity missed | [Fill after test] |
| Recognition accuracy | Correct matches / Total attempts x 100 | [Fill after test] |
| Average checkpoint confirmation time | Total time / Total confirmed students | [Fill after test] |
| Attendance export time | Time from click to file generation | [Fill after test] |
| Manual attendance duration | Stopwatch observation | [Fill after test] |
| Proposed system duration | Stopwatch observation | [Fill after test] |

Until those values are measured, the report should keep the performance analysis descriptive, clear, and honest.

---

# Chapter 5

## Conclusion

This chapter summarizes the work completed and identifies future development directions.

## 5.1 Conclusion

The project **InsightScan: AI-Based Smart Attendance System** demonstrates how biometric face recognition, browser-based AI, schedule-aware automation, and local persistence can be combined into a practical academic attendance platform. The system was designed to address the limitations of manual attendance and weakly authenticated digital attendance methods. By providing admin enrollment, secure admin login, student biometric registration, duplicate prevention, class schedule management, live attendance monitoring, historical records, and export support, the project delivers a complete attendance workflow rather than an isolated feature demo.

One of the major achievements of the project is the integration of recognition logic with actual academic context. The system does not merely recognize faces; it recognizes them with respect to an active class schedule and relevant department. This context-sensitive design makes the platform more meaningful than a generic face matching demo. The introduction of checkpoint-based presence verification further improves the academic usefulness of the system by tying attendance to continuity of presence instead of a one-time appearance.

Another important contribution of the project is its lightweight architecture. The use of React, TypeScript, `face-api.js`, and `sql.js` allows the entire application to operate largely within the browser. This reduces deployment complexity and makes the project easier to demonstrate, evaluate, and extend. The inclusion of structured storage, recovery workflows, lockout logic, and export features shows that the design pays attention not only to AI functionality but also to operational and administrative requirements.

From an academic perspective, the project successfully demonstrates interdisciplinary integration across web development, database management, computer vision, authentication, and user interface engineering. It shows that a student-level project can implement meaningful system logic with practical relevance to educational institutions. The current prototype forms a strong foundation for future improvements and real-world adaptation.

In conclusion, the proposed system achieves its primary objective of creating a smart attendance application that is more secure, automated, and administratively useful than traditional attendance practices. It serves as a convincing proof of concept for AI-assisted attendance management in academic environments.

## 5.2 Future Enhancements

Although the project is functionally complete as a prototype, several future enhancements can increase its accuracy, scalability, and institutional readiness.

### 5.2.1 Backend Synchronization

The current prototype stores most data locally in the browser. A future version can synchronize records with a central backend so that multiple classrooms, departments, and devices can share attendance data. This would support institutional deployment and centralized reporting.

### 5.2.2 Cloud or Campus Server Database

The SQLite browser store is ideal for prototyping, but a production version could use PostgreSQL, MySQL, or another secure institutional database. This would improve multi-user support, backup capability, and long-term administration.

### 5.2.3 Advanced Anti-Spoofing

The current scanner uses stable-frame logic as a practical liveness-oriented mechanism. Future versions can add stronger anti-spoofing methods such as blink detection, depth estimation, infrared support, or challenge-response prompts.

### 5.2.4 Mobile and Multi-Camera Support

Future deployment could support mobile devices, classroom tablets, or multi-camera integration to improve coverage in large classrooms. This would help the system adapt to different campus environments.

### 5.2.5 Analytics Dashboard

The project can be extended to include attendance trends, low-attendance alerts, subject-wise graphs, batch-level performance summaries, and faculty dashboards. This would increase the system's value beyond attendance marking.

### 5.2.6 Notification Features

Attendance shortage warnings could be sent automatically to students, mentors, or parents through email or messaging services. Such automation would make the platform more proactive.

### 5.2.7 Stronger AI Report Integration

The repository already includes a Gemini service for attendance summary generation. A future enhancement can integrate this visibly into the dashboard so that each session or weekly report automatically generates concise AI-based commentary for faculty.

### 5.2.8 Institutional Integrations

The platform can eventually integrate with:

- learning management systems,
- ERP software,
- departmental dashboards,
- student portals,
- and examination eligibility tracking systems.

### 5.2.9 Expanded Evaluation

Future work should include rigorous experimental evaluation using larger student groups under different lighting conditions, seating arrangements, and camera positions. This would allow the system to report measured accuracy, throughput, and error rates more formally.

These enhancements show that the project is scalable in concept and offers strong scope for future academic or practical development.

---

# Appendices

## Appendix 1: Suggested Figure Captions

Use figure captions like the following in the final report.

1. Figure 3.1 Block diagram of the proposed smart attendance system  
2. Figure 3.2 Flowchart of administrator authentication and attendance workflow  
3. Figure 4.1 Home page of the InsightScan application  
4. Figure 4.2 Face scanner with stable biometric capture progress  
5. Figure 4.3 Student enrollment interface  
6. Figure 4.4 Dashboard monitoring page  
7. Figure 4.5 Schedule management page  
8. Figure 4.6 Student identity vault  
9. Figure 4.7 History vault and filtering page  
10. Figure 4.8 CSV export result

## Appendix 2: Suggested Table Captions

1. Table 4.1 Tools and technologies used  
2. Table 4.2 Hardware requirements  
3. Table 4.3 Result table for admin authentication  
4. Table 4.4 Result table for student enrollment  
5. Table 4.5 Result table for timetable and monitoring  
6. Table 4.6 Illustrative attendance output  
7. Table 4.7 Design-level performance parameters  
8. Table 4.8 Comparison with existing system

## Appendix 3: Database Schema Description

### Admin Table

| Field | Type | Description |
|---|---|---|
| id | INTEGER | Fixed primary key for admin record |
| name | TEXT | Administrator name |
| face_description | TEXT | Serialized face descriptor |
| recovery_secret | TEXT | Recovery password |
| recovery_email | TEXT | Gmail address for password reset |
| registered_at | TEXT | Timestamp of admin enrollment |

### Student Table

| Field | Type | Description |
|---|---|---|
| id | TEXT | Unique student ID |
| register_number | TEXT | Academic register number |
| name | TEXT | Student name |
| email | TEXT | Student email |
| department | TEXT | Department name |
| enrollment_year | INTEGER | Year of enrollment |
| status | TEXT | Current status field |
| face_description | TEXT | Serialized biometric descriptor |
| created_at | TEXT | Record creation timestamp |

### Metadata Table

| Field | Type | Description |
|---|---|---|
| key | TEXT | Metadata key |
| value | TEXT | Metadata value |

## Appendix 4: Data Dictionary

### Student

- `id`: internal system identifier  
- `registerNumber`: academic register number  
- `name`: student full name  
- `email`: generated or assigned institutional email  
- `department`: branch or department  
- `enrollmentYear`: academic batch year  
- `status`: present/absent/late state reference  
- `faceDescription`: serialized biometric vector

### Timetable Entry

- `id`: unique class identifier  
- `subject`: subject or course title  
- `department`: relevant student department  
- `startTime`: class start time  
- `endTime`: class end time  
- `dayOfWeek`: recurring day  
- `calendarDate`: optional specific date

### History Record

- `id`: unique attendance history record  
- `classId`: class reference  
- `studentId`: student reference  
- `date`: attendance date  
- `name`: student name  
- `registerNumber`: student register number  
- `subject`: class subject  
- `department`: class department  
- `attendance`: present or absent

## Appendix 5: Pseudocode for Key Functions

### A. Duplicate Face Detection

```text
function findRegisteredFaceMatch(newDescriptor, existingCandidates):
    rankedMatches = []
    for each candidate in existingCandidates:
        distance = euclidean(newDescriptor, candidate.descriptor)
        cosine = cosineSimilarity(newDescriptor, candidate.descriptor)
        add (candidate, distance, cosine) to rankedMatches

    sort rankedMatches by distance ascending then cosine descending
    best = first match

    if best.distance <= duplicateDistanceThreshold
       and best.cosine >= duplicateCosineThreshold:
        return best
    else:
        return null
```

### B. Active Class Detection

```text
function checkActiveClass(currentDate, currentTime, timetable):
    matches = all timetable entries where:
        day matches current day
        and calendar date is empty or equal to current date
        and startTime <= currentTime <= endTime

    prioritize date-specific entries over recurring entries
    return first matching entry or null
```

### C. Attendance Status Update

```text
for each student in currentClassStudents:
    if checkpoints completed continuously up to current stage:
        mark present
    else:
        mark absent
```

## Appendix 6: Sample Test Cases

| Test ID | Module | Input | Expected Output |
|---|---|---|---|
| TC01 | Admin enrollment | Valid admin details and face | Admin saved |
| TC02 | Admin login | Correct admin face | Dashboard opens |
| TC03 | Admin login | Wrong face three times | Lockout activated |
| TC04 | Recovery access | Correct recovery secret | Access granted |
| TC05 | Gmail recovery | Correct Gmail and new password | Password updated |
| TC06 | Student enrollment | Unique face and register number | Student saved |
| TC07 | Student enrollment | Duplicate register number | Rejected |
| TC08 | Student enrollment | Duplicate face | Rejected |
| TC09 | Schedule add | Valid subject and time | Class added |
| TC10 | Live monitoring | Active class present | Monitoring begins |
| TC11 | History filter | Select date and department | Filtered records shown |
| TC12 | CSV export | Trigger export | CSV downloaded |

## Appendix 7: User Manual

### Administrator Manual

1. Open the application in a supported browser.
2. If this is the first use, enter admin name, recovery secret, and Gmail.
3. Position the face correctly and complete biometric enrollment.
4. Log in through face verification on later uses.
5. Register students one by one with full details and face capture.
6. Open the schedule tab and create timetable entries.
7. During an active class, open monitoring to watch live attendance.
8. Review attendance percentages and student checkpoint status.
9. Open history to review previous records.
10. Export CSV files whenever needed.

### Student Enrollment Guidelines

- Ensure good lighting.
- Ask the student to face the camera directly.
- Avoid enrolling the same student twice.
- Confirm correct register number and department before saving.

### Monitoring Guidelines

- Place the webcam where most students are visible.
- Avoid frequent camera movement.
- Use the schedule tab to ensure class timings are accurate.
- Check history after the session to review final records.

## Appendix 8: Limitations and Ethical Considerations

### Privacy Considerations

Because the project handles biometric information, informed institutional usage is important. Students should be clearly informed that facial descriptors are being used for attendance purposes. Storage and sharing policies should be defined before real deployment.

### Bias and Environmental Conditions

Face recognition performance may vary with lighting, pose, occlusion, and camera quality. Therefore, operational evaluation should include diverse classroom conditions before large-scale use.

### Security Considerations

Although the project includes admin verification and lockout logic, production deployment should further protect the stored biometric descriptors, recovery methods, and exported data files.

### Ethical Use

The system should be used strictly for academic attendance and not for unrelated surveillance. Institutional transparency, consent policies, and limited-purpose data handling are important.

## Appendix 9: Viva Preparation Notes

### Possible Viva Questions with Short Answers

**Q1. Why did you choose face recognition for attendance?**  
Because it provides contactless identity verification, reduces proxy attendance, and can be integrated with a normal classroom webcam.

**Q2. Why did you use a browser-based architecture?**  
It reduces deployment complexity, supports easy demonstration, and shows that modern web technologies can handle AI-assisted attendance workflows.

**Q3. Why is SQLite used instead of a server database?**  
SQLite through `sql.js` keeps the prototype lightweight, portable, and easy to run locally without backend setup.

**Q4. What is the purpose of checkpoint-based attendance?**  
It ensures continuity of presence across the session instead of marking attendance based on one-time detection.

**Q5. How do you prevent duplicate student registration?**  
The system checks register number, student name, and biometric similarity before saving a new student.

**Q6. How is admin security improved?**  
Through biometric login, repeated confirmation, intrusion counting, lockout, and recovery controls.

**Q7. What are the limitations of the prototype?**  
It still depends on camera quality, lighting, browser execution, and further benchmarking for formal accuracy metrics.

## Appendix 10: Final Submission Checklist

- Replace college name, guide name, and student details.
- Add certificate and approval pages if required by your institution.
- Insert all screenshots with figure numbers.
- Convert block diagram and flowchart into proper figures.
- Add page numbers and table of contents.
- Add list of figures and list of tables.
- Check chapter numbering after skipping Chapter 2.
- Add recent references separately if required.
- Proofread grammar and formatting before printing.

## Appendix 11: Detailed Screen-Wise Documentation

This appendix can be used directly if your guide expects more explanation for the implemented interface. Each subsection below can be placed under implementation or appendices depending on the required report format.

### A. Landing Page and Identity Entry Screen

The landing page is the first point of interaction between the operator and the system. Its design is important because it determines whether the application appears as a casual demo or as a serious administrative platform. In the current project, the landing page is not merely a login screen. It also acts as an onboarding page for the first-time administrator, a biometric verification page for subsequent login attempts, and a recovery page when facial verification cannot be completed.

The screen contains themed visual branding, a biometric scanner section, and form inputs that adapt according to the current workflow state. If no admin profile exists in storage, the page prompts for admin name, recovery secret, and Gmail address. This establishes a secure identity foundation before the dashboard can ever be accessed. The design ensures that the camera is enabled only after sufficient inputs are available, which makes the interface more deliberate and reduces confusion for the user.

### B. Face Scanner Visualization Screen

The face scanner is one of the most technically expressive parts of the application. It includes a live camera feed, visual face framing, stable detection progress, technical status feedback, and camera retry guidance. This makes the AI process visible and interpretable to the user rather than hidden in the background.

From a report-writing perspective, this screen is important because it shows how artificial intelligence is integrated into a usable product. The detection box, live progress feedback, and scanner state messages demonstrate that the project is not limited to back-end logic; it also includes thoughtful human-computer interaction. If a screenshot of this page is placed in the report, it should be accompanied by a note explaining that face descriptors are generated only after a stable face sequence is observed.

### C. Administrator Recovery Screen

An attendance system with only biometric login would become unusable if camera access fails or if the stored face cannot be captured properly in a given environment. For that reason, the current project includes a recovery interface. This page allows the admin to sign in using the recovery secret or to reset the recovery secret using the registered Gmail account.

This screen strengthens the practical relevance of the project. In real institutional software, administrators expect a controlled fallback path. The recovery screen proves that the design does not assume ideal camera availability at all times. It also adds academic depth because it allows the report to discuss resilience, role protection, and recovery-oriented system design.

### D. Student Enrollment Screen

The student enrollment screen is where academic identity details and biometric identity become linked. The screen is expected to collect the student name, register number, department, and enrollment year before enabling biometric registration. This order reflects sensible workflow design because the face descriptor should correspond to a clearly defined academic record.

This screen also embodies one of the main quality-control mechanisms of the project. Duplicate checks are performed against prior biometric entries, register numbers, and names. Therefore, the screen is not a simple form submission page; it is a gatekeeping stage for the integrity of the identity database. In the final report, this page can be used to explain why a strong enrollment stage is critical for the success of the later recognition phase.

### E. Success Notification Screen

After a successful student registration, the system displays a success toast or notification. This may seem like a small interface detail, but it is worth documenting. In administrative systems, feedback must be immediate and unambiguous. A notification that confirms successful storage assures the operator that the biometric and academic record were actually accepted by the system.

This visual event also helps the report show that the system was tested as an end-to-end interaction, not only as isolated internal functions. A screenshot of the success message can be placed in the implementation chapter to demonstrate positive-path completion.

### F. Main Dashboard Screen

The main dashboard is the operational core of the application. It is where the authenticated admin navigates between monitoring, schedule management, and identity management. A good dashboard is significant in an academic attendance project because faculty or administrators need quick access to system state, not a confusing sequence of unconnected pages.

The dashboard demonstrates the maturity of the interface design. It includes summary cards, navigation grouping, visual indicators, and quick access to the most relevant administrative controls. A screenshot of this screen should be explained in the report as the unified control center that connects live attendance and record management.

### G. Live Monitoring Screen

The live monitoring screen is perhaps the most important demonstration page for viva and report evaluation. It shows the system operating in real time during an active class. The display can include the active subject, checkpoint status, counts of present and absent students, and indication of recently detected students.

In report form, this screen is useful because it bridges theory and practice. It visually confirms that the project does not stop at enrollment and storage but extends all the way to real-time attendance generation. If the report includes only one major result screenshot, this should be the highest-priority one.

### H. Schedule Management Screen

The schedule management page allows the admin to define academic sessions with time and department context. This page is vital because it transforms the system from a generic face recognition application into an attendance-specific application. Without schedule context, the system would not know when to monitor or which department to scan.

From a documentation standpoint, this screen supports the explanation of automated class activation. The report should mention that schedule creation improves both accuracy and efficiency by ensuring that recognition is aligned with the correct classroom session.

### I. Identity Vault Screen

The identity vault or student list screen presents registered student records in an organized tabular form. It includes batch filtering, department distribution, and deletion support. This page proves that the project supports record maintenance, not just initial capture.

This screen is useful in the report for explaining data management quality. Evaluators often look for whether a project can handle modification, deletion, and review of stored data. The identity vault helps answer that expectation convincingly.

### J. History Vault Screen

The history vault screen gives the project long-term usefulness. It allows the admin to inspect attendance records after the live session is complete. Since history can be filtered by date and department, it supports academic review and traceability.

In the report, this page should be described as the archival layer of the system. It shows that the attendance workflow ends not just in temporary live recognition, but in retrievable session records that can be exported and studied later.

## Appendix 12: Extended Discussion Points for Review or Viva

### Why This Project Is Meaningful

This project is meaningful because it takes a familiar administrative task and redesigns it through a combination of AI and software engineering. Attendance is simple in concept but difficult to manage accurately at scale. By framing the problem through the lens of biometric computing and real-time monitoring, the project demonstrates that even a routine institutional workflow can become a valid and rich computing problem.

The project also shows a practical attitude toward implementation. It does not depend on a heavy server deployment or specialized classroom terminal. Instead, it proves that a modern browser can act as an application runtime, biometric interface, and storage host. This makes the system appropriate for academic demonstration and valuable as a prototype.

### Why the Project Is Not Just a Face Recognition Demo

A common criticism of student AI projects is that they stop at a single isolated feature such as image classification or face detection. This project moves beyond that. Face recognition is only one part of the system. The project also includes authentication, duplicate validation, schedule logic, checkpoint-based attendance, structured storage, history generation, export support, and recovery controls.

Because of these additional modules, the project can be defended as a complete software system rather than a one-screen artificial intelligence demonstration. This is an important discussion point during evaluation.

### Engineering Strengths of the Project

The engineering strengths of the current implementation include:

- modular file organization,
- type-safe data models,
- local relational storage,
- graceful recovery mechanisms,
- anti-duplication checks,
- adaptive monitoring,
- and production build readiness.

These strengths show that attention was given to maintainability and correctness, not only to visual design.

### Academic Strengths of the Project

From an academic perspective, the project brings together concepts from several subjects:

- web technology,
- software engineering,
- database systems,
- artificial intelligence,
- computer vision,
- and human-computer interaction.

Because it spans multiple areas, it is suitable for an undergraduate thesis or final-year project report.

### Real-World Relevance

The project is directly relevant to colleges and institutions where faculty time is limited and class strength is high. Even if the current prototype is not yet a campus-wide deployment tool, the core workflow is practical enough to be recognized as a solution to a real problem.

### Honest Statement About Current Boundaries

An honest report should mention that the prototype remains an academic implementation. It is suitable for demonstration, experimentation, and extension, but real deployment would require stronger evaluation, privacy policy planning, server synchronization, and possibly hardware calibration. Making this distinction improves the credibility of the report.

## Appendix 13: Glossary and Acronyms

| Term | Meaning |
|---|---|
| AI | Artificial Intelligence |
| Biometric | A measurable physical trait used for identity verification |
| Face Descriptor | Numeric representation of facial features used for matching |
| Cosine Similarity | Metric used to measure similarity between descriptor vectors |
| Euclidean Distance | Distance metric used to compare biometric vectors |
| Liveness | Evidence that the captured face belongs to a live person and not a static image |
| SQLite | Lightweight relational database engine |
| sql.js | Browser-based SQLite implementation using WebAssembly |
| Dashboard | Main administrative control screen of the application |
| Checkpoint | One phase of the attendance verification timeline |
| CSV | Comma Separated Values file format used for export |
| Authentication | Process of verifying identity |
| Enrollment | Initial registration of a biometric user |
| Intruder Lockout | Temporary blocking after repeated failed access attempts |
| Timetable Entry | Structured schedule record for a class session |
| History Vault | Stored attendance records view |
| Single Page Application | Web application that runs dynamically on one page |
| Vite | Front-end build tool used in the project |
| React | UI library used to build the application |
| TypeScript | Typed superset of JavaScript used for code reliability |

---

## References Note

The PDF indicates that the final thesis should include about 25 recent references. Since you asked to skip Chapter 2 and the current task focused on project-specific report content, references are not fabricated here. If needed, a separate references section can be prepared next using recent papers from 2023, 2024, and 2025 related to face recognition attendance systems, biometric authentication, liveness detection, and educational automation.
