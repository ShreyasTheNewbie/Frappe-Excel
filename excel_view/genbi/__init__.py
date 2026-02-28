"""
GenBI (Generative BI) - AI-powered conversational canvas builder.

This module provides natural language understanding for Excel View's join canvas,
enabling users to build complex data relationships through conversation.

Components:
- IntentClassifier: Understands user intent (find, explain, build, analyze)
- EntityResolver: Extracts and disambiguates DocType entities from queries
- ConversationState: Manages multi-turn conversation context
- RelationshipExplainer: Generates human-readable relationship explanations
- QueryParser: Parses complex queries into canvas configurations
- DataInsights: Provides data-aware suggestions and warnings
"""

__version__ = "1.0.0"
