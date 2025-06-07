import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import axios from "axios";
import {onCall} from "firebase-functions/v2/https";
import express from "express";

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

admin.initializeApp();

// Create Express app for direct Cloud Run deployment
const app = express();

interface InterviewQuestion {
  difficulty: string;
  keywords: string[];
  question: string;
  topic: string;
  candidateAnswer: string | null;
  score: number;
  explanation: string;
}

interface InterviewDocModel {
  title: string;
  questionsCount: number;
  domain: string | null;
  topics: string;
  difficulty: string;
  jobDescription: string;
  resume: string;
  date: string;
  preciseTime: string;
  analysed: boolean;
  evaludationId: string | null;
  interviewQuestions: InterviewQuestion[] | null;
  type: string;
}

interface FunctionData {
  docId: string;
}

export const evaluateMockInterview = onCall<FunctionData>(async (request) => {
  // Check if the user is authenticated
  if (!request.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    );
  }

  const userId = "EmlxiPsnXqT38FXVm4TCRywzvQq2";
  const docId = request.data.docId;

  try {
    // Start processing the interview for evaluation
    functions.logger.info("Starting progress evaluation process", {docId});

    // Retrieve the document data
    const docRef = `users/${userId}/archives`;
    const docSnapshot = await admin.firestore()
      .collection(docRef)
      .doc(docId)
      .get();

    functions.logger.info("Starting point 2", {docId});

    if (!docSnapshot.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "Interview document not found"
      );
    }

    const interviewData = docSnapshot.data() as InterviewDocModel;

    // Update document to indicate processing has started
    await admin.firestore()
      .collection(docRef)
      .doc(docId)
      .update({
        "analysed": false,
        "evaluationInProgress": true,
      });

    functions.logger.info("Starting point 3", {docId});

    // Process each interview question with DeepSeek API
    const evaluatedQuestions =
      await evaluateInterviewAnswers(interviewData);

    // Update the document with evaluation results
    await admin.firestore()
      .collection(docRef)
      .doc(docId)
      .update({
        "interviewQuestions": evaluatedQuestions,
        "analysed": true,
        "evaluationInProgress": false,
      });

    functions.logger.info("Starting point 4", {docId});

    // Send notification to the user that their evaluation is ready
    await sendEvaluationNotification(userId, docId);

    return {success: true, docId};
  } catch (error) {
    functions.logger.error("Error evaluating interview", error);
    throw new functions.https.HttpsError(
      "internal",
      "Error evaluating interview"
    );
  }
});

/**
 * Evaluates the candidate's interview answers using DeepSeek API
 * @param {InterviewDocModel} interviewData - The interview data containing
 *        questions and answers
 * @return {Promise<InterviewQuestion[]>} Array of evaluated interview questions
 */
async function evaluateInterviewAnswers(
  interviewData: InterviewDocModel
): Promise<InterviewQuestion[]> {
  if (!interviewData.interviewQuestions ||
      interviewData.interviewQuestions.length === 0) {
    throw new Error("No interview questions found");
  }

  const evaluatedQuestions: InterviewQuestion[] = [];

  for (const question of interviewData.interviewQuestions) {
    if (!question.candidateAnswer) {
      // Skip questions with no answers
      evaluatedQuestions.push({
        ...question,
        score: 0,
        explanation: "No answer provided",
      });
      continue;
    }

    // Create the prompt for DeepSeek API
    const messages = [
      {
        role: "system",
        content:
          "You are an expert technical interviewer for " +
          `${interviewData.domain || "technology"} positions.\n` +
          "Evaluate the candidate's answer to the interview question.\n" +
          "Consider technical accuracy, clarity, completeness.\n" +
          "Score from 0-5 and provide brief, specific feedback.\n" +
          "Format as JSON: {\"score\": number, \"explanation\": \"string\"}",
      },
      {
        role: "user",
        content:
          `Question: ${question.question}\n\n` +
          `Candidate's Answer: ${question.candidateAnswer}\n\n` +
          `Difficulty: ${question.difficulty}\n` +
          `Topics: ${question.topic}\n` +
          `Keywords: ${question.keywords.join(", ")}`,
      },
    ];

    try {
      const response = await axios.post(
        "https://api.deepseek.com/chat/completions",
        {
          messages,
          model: "deepseek-chat",
          response_format: {type: "json_object"},
        },
        {
          headers: {
            "Authorization": "Bearer sk-c707e08e61fe4ba2ab4b9f51d1e79410",
            "Content-Type": "application/json",
          },
        }
      );

      const aiResponse = response.data.choices[0].message.content;
      const evaluation = JSON.parse(aiResponse);

      evaluatedQuestions.push({
        ...question,
        score: evaluation.score,
        explanation: evaluation.explanation,
      });
    } catch (error) {
      functions.logger.error("Error calling DeepSeek API", error);

      // If API fails, add a placeholder evaluation
      evaluatedQuestions.push({
        ...question,
        score: 0,
        explanation: "Error evaluating answer. Please try again later.",
      });
    }
  }

  return evaluatedQuestions;
}

/**
 * Sends a notification to the user when their interview evaluation is ready
 * @param {string} userId - The user's ID
 * @param {string} docId - The document ID of the evaluated interview
 * @return {Promise<void>}
 */
async function sendEvaluationNotification(
  userId: string,
  docId: string
): Promise<void> {
  const message = {
    data: {
      type: "interview_evaluation",
      title: "Interview Evaluation Ready",
      message: "Your mock interview has been evaluated! Tap to view results.",
      docId: docId,
    },
    topic: `interview-evaluation-${docId}`,
  };

  try {
    await admin.messaging().send(message);
    functions.logger.info("Notification sent successfully", {docId});
  } catch (error) {
    functions.logger.error("Error sending notification", error);
  }
}

const port = process.env.PORT || 8080;
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server listening on port ${port}...`);
  });
}

export const expressApp = app;
